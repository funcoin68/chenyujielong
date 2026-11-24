// room-authority: the ONLY writer to the rooms table (CYJ-17).
// Transport only — decision logic lives in src/lib/room/ (see
// supabase/functions/README.md): this file owns env checks, session-cookie
// resolution, PostgREST IO, and HTTP responses; src/lib/room/ owns every
// branch decision (400/401/200/500 mapping).
import { generateRoomCode } from '../../../src/lib/room/code.ts'
import { isWellFormedRoomCode } from '../../../src/lib/room/code.ts'
import { createRoomDecision, parseCreateRoomBody } from '../../../src/lib/room/createRoom.ts'
import type { RoomSettingsInput } from '../../../src/lib/room/createRoom.ts'
import { activeRoomDecision } from '../../../src/lib/room/activeRoom.ts'
import { joinedRoomsDecision } from '../../../src/lib/room/joinedRooms.ts'
import type { JoinedMembershipRow } from '../../../src/lib/room/joinedRooms.ts'
import { closeRoomDecision, parseCloseRoomBody } from '../../../src/lib/room/closeRoom.ts'
import { leaveRoomDecision, parseLeaveRoomBody } from '../../../src/lib/room/leaveRoom.ts'
import { getRoomDecision } from '../../../src/lib/room/getRoom.ts'
import type { RoomPlayerRow } from '../../../src/lib/room/getRoom.ts'
import { joinRoomDecision, parseJoinRoomBody } from '../../../src/lib/room/joinRoom.ts'
import { lookupRoomByCodeDecision } from '../../../src/lib/room/lookupRoomByCode.ts'
import { parseUpdateRoomBody, updateRoomDecision } from '../../../src/lib/room/updateRoom.ts'
import { resolveUserId } from '../../../src/lib/auth/session.ts'

// AC: missing config must be a loud cold-start error, not a silent 500.
const REQUIRED_ENV = ['APP_BASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
const missingEnv = REQUIRED_ENV.filter((name) => !Deno.env.get(name))
if (missingEnv.length > 0) {
  console.error(
    `FATAL room-authority: missing env vars: ${missingEnv.join(', ')} — set them in Supabase project secrets`,
  )
}
const configured = missingEnv.length === 0

const CONFIG = {
  appBaseUrl: (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/+$/, ''),
  supabaseUrl: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
}

// PostgREST via the service role — RLS is enabled with no policies, so ONLY
// this function can touch rooms (same isolation as the auth function).
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${CONFIG.supabaseUrl}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: CONFIG.serviceRoleKey,
      Authorization: `Bearer ${CONFIG.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

interface RoomRow {
  id: string
  code: string
  name: string | null
  status: string
  owner_id: string
}

// CYJ-23: the lookups now distinguish "PostgREST failed" from "no row", so a
// read failure is a loud 500 (rule 12) instead of masquerading as an empty
// state or a 404. Callers of the create path treat a failed lookup as null —
// the insert/409-retry/500 fallback there still fails loudly.
type SelectResult = { ok: true; row: RoomRow | null } | { ok: false }

async function selectActiveRoom(userId: string): Promise<SelectResult> {
  const res = await rest(
    `/rooms?owner_id=eq.${userId}&status=neq.closed&select=id,code,name,status&order=created_at.desc&limit=1`,
  )
  if (!res.ok) {
    console.error(`room-authority: active-room lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, row: ((await res.json()) as RoomRow[])?.[0] ?? null }
}

async function selectRoomById(roomId: string): Promise<SelectResult> {
  // CYJ-23 review (round 1, security): roomId is client-supplied — encode it
  // before interpolating into the PostgREST query string (the PATCH path
  // below reuses the same encoding).
  const res = await rest(
    `/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,code,name,status,owner_id&limit=1`,
  )
  if (!res.ok) {
    console.error(`room-authority: room lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, row: ((await res.json()) as RoomRow[])?.[0] ?? null }
}

// CYJ-34: one PostgREST round trip for the Lobby's joined-rooms section — the
// caller's room_players rows (WITHOUT an is_host filter: the host exclusion
// is the decision layer's job, so it stays Vitest-covered) with each room and
// its players embedded; the host's display_name comes from the nested
// room_players → users embed (display_name ONLY — never email, PII
// discipline). rooms!inner + rooms.status=neq.closed drops closed rooms in
// the same query: a closed room's code is dead and join-room 404s on it, so
// listing it would be a dead link (same filter as selectActiveRoom). userId
// is server-derived (session row), so it needs no encoding (CYJ-23
// discipline applies to client-supplied values only).
interface JoinedMembershipQueryRow {
  is_host: boolean
  // room_players → rooms is many-to-one, so PostgREST embeds a single object
  // (the nested room_players → users embed below is one-to-many: an array).
  rooms: {
    id: string
    code: string
    name: string | null
    room_players: { is_host: boolean; users: { display_name: string | null } | null }[]
  }
}

async function selectJoinedRooms(
  userId: string,
): Promise<{ ok: true; rows: JoinedMembershipQueryRow[] } | { ok: false }> {
  const res = await rest(
    `/room_players?user_id=eq.${userId}` +
      '&select=is_host,rooms!inner(id,code,name,room_players(is_host,users(display_name)))' +
      '&rooms.status=neq.closed',
  )
  if (!res.ok) {
    console.error(`room-authority: joined-rooms lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, rows: (await res.json()) as JoinedMembershipQueryRow[] }
}

// CYJ-32: the caller's room_players row, looked up before any write — the
// decision layer refuses non-members and the host, so the DELETE can only
// ever remove the caller's own non-host row. roomId is client-supplied, so it
// is encoded before interpolation (CYJ-23 discipline); userId is
// server-derived (session row) and needs none.
type MembershipResult = { ok: true; row: { user_id: string; is_host: boolean } | null } | { ok: false }

async function selectMembership(roomId: string, userId: string): Promise<MembershipResult> {
  const res = await rest(
    `/room_players?room_id=eq.${encodeURIComponent(roomId)}&user_id=eq.${userId}&select=user_id,is_host&limit=1`,
  )
  if (!res.ok) {
    console.error(`room-authority: membership lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, row: ((await res.json()) as { user_id: string; is_host: boolean }[])?.[0] ?? null }
}

// CYJ-31: the join-by-code lookup returns ONLY id+code — the smallest payload
// that lets the client navigate to /room/:roomId (full room+players stays on
// GET /room/<id>, CYJ-24), minimizing this unauthenticated endpoint's surface.
type CodeLookupResult = { ok: true; row: { id: string; code: string } | null } | { ok: false }

async function selectRoomIdByCode(code: string): Promise<CodeLookupResult> {
  // The code is client-supplied (path segment) — encode before interpolating
  // (CYJ-23 discipline). Well-formedness is the decision layer's job; this
  // query only ever runs for codes that passed the alphabet check.
  const res = await rest(`/rooms?code=eq.${encodeURIComponent(code)}&select=id,code&limit=1`)
  if (!res.ok) {
    console.error(`room-authority: room-by-code lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, row: ((await res.json()) as { id: string; code: string }[])?.[0] ?? null }
}

async function insertRoom(
  userId: string,
  settings: RoomSettingsInput,
): Promise<{ row: RoomRow | null; conflict: boolean }> {
  const res = await rest('/rooms', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      code: generateRoomCode(),
      owner_id: userId,
      name: settings.name,
      rule: settings.rule,
      turn_seconds: settings.turnSeconds,
      max_players: settings.maxPlayers,
      win_condition: settings.winCondition,
      dictionary: settings.dictionary,
    }),
  })
  if (res.status === 409) {
    await res.body?.cancel()
    // Unique violation on rooms_one_active_per_owner: a concurrent create won
    // the race. The partial index guarantees the winner's row is committed.
    return { row: null, conflict: true }
  }
  if (!res.ok) {
    console.error(`room-authority: room insert failed: HTTP ${res.status} ${await res.text()}`)
    return { row: null, conflict: false }
  }
  return { row: ((await res.json()) as RoomRow[])?.[0] ?? null, conflict: false }
}

// CYJ-24: the host's room_players row is written with the room on the create
// path. There is no cross-PostgREST transaction, so a player-insert failure
// after a successful room insert is surfaced loudly (rule 12) as a 500 — the
// residual is a room whose player list is empty (visible in the WaitingRoom
// as 0 players), never fixture data and never a silent partial success.
// CYJ-33: generalized to take isHost so the join path inserts non-host rows
// through the same function; a 409 (unique(room_id, user_id) — a concurrent
// same-user join) is reported as `conflict` so the join transport can treat
// it as an idempotent 200 while the create path still fails loudly.
type InsertPlayerResult = { ok: true } | { ok: false; conflict: boolean }

async function insertRoomPlayer(
  roomId: string,
  userId: string,
  isHost: boolean,
): Promise<InsertPlayerResult> {
  const res = await rest('/room_players', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ room_id: roomId, user_id: userId, is_host: isHost }),
  })
  if (res.status === 409) {
    await res.body?.cancel()
    return { ok: false, conflict: true }
  }
  if (!res.ok) {
    // CYJ-24 review (round 2, security): status only — the PostgREST error
    // body can echo constraint names/SQL detail into edge-function logs
    // (same discipline as selectRoomWithPlayers).
    console.error(`room-authority: player insert failed: HTTP ${res.status}`)
    return { ok: false, conflict: false }
  }
  return { ok: true }
}

// CYJ-24: one PostgREST round trip for the WaitingRoom — the room row plus its
// players (host first) with each player's users-profile embed. roomId is
// client-supplied, so it is encoded before interpolation (CYJ-23 precedent).
interface RoomWithPlayersRow extends RoomRow {
  max_players: number
  rule: string
  turn_seconds: number
  win_condition: string
  dictionary: string
  room_players: {
    user_id: string
    is_host: boolean
    users: { display_name: string | null; avatar_url: string | null } | null
  }[]
}

async function selectRoomWithPlayers(
  roomId: string,
): Promise<{ ok: true; row: RoomWithPlayersRow | null } | { ok: false }> {
  const res = await rest(
    `/rooms?id=eq.${encodeURIComponent(roomId)}` +
      '&select=id,code,name,status,owner_id,max_players,rule,turn_seconds,win_condition,dictionary,room_players(user_id,is_host,users(display_name,avatar_url))&room_players.order=is_host.desc,joined_at.asc' +
      '&limit=1',
  )
  if (!res.ok) {
    console.error(`room-authority: room-with-players lookup failed: HTTP ${res.status}`)
    return { ok: false }
  }
  return { ok: true, row: ((await res.json()) as RoomWithPlayersRow[])?.[0] ?? null }
}

// Session resolution (CYJ-7): the raw token lives in the httpOnly cookie;
// the DB stores its SHA-256 hash. The token -> user logic itself lives in
// the shared lib (src/lib/auth/session.ts resolveUserId) so the Edge
// Functions can't drift on expiry/rotation semantics — this closure is the
// PostgREST transport only.
async function lookupSession(
  tokenHash: string,
): Promise<{ expires_at: string; user_id: string } | null> {
  const res = await rest(`/sessions?token_hash=eq.${tokenHash}&select=expires_at,user_id`)
  if (!res.ok) {
    console.error(`room-authority: session lookup failed: HTTP ${res.status}`)
    return null
  }
  return ((await res.json()) as { expires_at: string; user_id: string }[])?.[0] ?? null
}

// CYJ-17 review (round 1, security): bound mass room creation. The
// one-active-room partial unique index already caps abuse per user; an
// in-memory sliding window caps write churn per authenticated user so a
// fleet of accounts can't flood the rooms table. Per-isolate, so it bounds
// rather than hard-limits; a platform-level limit is the eventual follow-up
// (the auth function has none either — convention noted in the review reply).
// CYJ-23 review (round 2, standards): one shared sliding-window helper,
// parameterized by hit map + ceiling — creates and closes keep INDEPENDENT
// budgets (separate maps), but only one copy of the pattern exists.
const RATE_WINDOW_MS = 60_000
const CREATE_MAX_PER_WINDOW = 5
const CLOSE_MAX_PER_WINDOW = 10
const UPDATE_MAX_PER_WINDOW = 10
const LEAVE_MAX_PER_WINDOW = 10
const JOIN_MAX_PER_WINDOW = 10
// CYJ-31: bound the code-collision retry (see handleCreateRoom). 32^6 ≈ 1.07B
// possible codes, so three fresh draws make a persistent collision effectively
// impossible; beyond the bound the decision layer returns an explicit 409.
const MAX_INSERT_ATTEMPTS = 3
const createHits = new Map<string, number[]>()
const closeHits = new Map<string, number[]>()
const updateHits = new Map<string, number[]>()
const leaveHits = new Map<string, number[]>()
const joinHits = new Map<string, number[]>()

function writeThrottled(
  hits: Map<string, number[]>,
  userId: string,
  maxPerWindow: number,
  now = Date.now(),
): boolean {
  const cutoff = now - RATE_WINDOW_MS
  const recent = (hits.get(userId) ?? []).filter((t) => t > cutoff)
  if (recent.length >= maxPerWindow) {
    hits.set(userId, recent)
    return true
  }
  recent.push(now)
  hits.set(userId, recent)
  return false
}

function withCors(headers: Headers): Headers {
  headers.set('Access-Control-Allow-Origin', CONFIG.appBaseUrl)
  headers.set('Access-Control-Allow-Credentials', 'true')
  return headers
}

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}

async function handleCreateRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  // Auth boundary first (AC #4): a session-less caller always gets 401 —
  // regardless of body shape, so validation behavior never leaks to
  // unauthenticated callers. CYJ-20: the session resolves through the SAME
  // shared path as /auth/me (src/lib/auth/session.ts resolveUserId) — cookie
  // first, x-cyj-session header fallback — so browsers blocking third-party
  // cookies authenticate here exactly as they do on /auth/me. Expired and
  // unknown sessions both map to the CYJ-15 no-session body (AC #2).
  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }
  const userId = session.row.user_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400, headers)
  }
  const parsed = parseCreateRoomBody(body)
  if (!parsed.ok) {
    return json({ error: parsed.reason }, 400, headers)
  }

  const existing = await selectActiveRoom(userId)
  if (existing.ok && existing.row) {
    return json(createRoomDecision({ userId, room: existing.row }).body, 200, headers)
  }

  if (writeThrottled(createHits, userId, CREATE_MAX_PER_WINDOW)) {
    return json({ error: 'too many rooms created, try again in a minute' }, 429, headers)
  }

  // CYJ-31: a 409 means one of TWO unique constraints fired — the
  // one-active-room partial index (a concurrent create won; the re-select
  // returns the winner's room) or rooms.code unique (a code collision).
  // Only the second is retryable, and only when the re-select affirms no
  // active room exists. Bounded at MAX_INSERT_ATTEMPTS with a fresh code per
  // insert (insertRoom draws a new generateRoomCode() each call), then the
  // decision layer's explicit 409 — never a 500 or a silent success.
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const inserted = await insertRoom(userId, parsed.settings)
    if (inserted.row) {
      // CYJ-24: the owner is the room's first player (host). A failure here
      // leaves a room with an empty player list — loud 500 (rule 12), never a
      // silent partial success.
      if (!(await insertRoomPlayer(inserted.row.id, userId, true)).ok) {
        return json(createRoomDecision({ userId, room: null }).body, 500, headers)
      }
      return json(createRoomDecision({ userId, created: inserted.row }).body, 200, headers)
    }
    if (!inserted.conflict) {
      // Non-409 insert failure — fail loudly (rule 12), never silently.
      return json(createRoomDecision({ userId, room: null }).body, 500, headers)
    }
    // Re-select after the 409: the partial index guarantees exactly one
    // active row now exists, so this returns the winner's room (AC #2/#3).
    const winner = await selectActiveRoom(userId)
    if (!winner.ok) {
      // A failed re-select is a loud 500 (rule 12), never a retry that could
      // mask a PostgREST outage as a code collision.
      return json({ error: 'active room lookup failed' }, 500, headers)
    }
    if (winner.row) {
      return json(createRoomDecision({ userId, room: winner.row }).body, 200, headers)
    }
    // No winner after a 409: rooms.code unique fired, not the partial index —
    // retry the insert with a fresh code (loop).
  }
  // Persistent code collision across every attempt — the decision layer's
  // explicit 409 (AC #3), not a 500.
  const decision = createRoomDecision({ userId, room: null, codeConflict: true })
  return json(decision.body, decision.status, headers)
}

// CYJ-23: read-only view of the caller's active room for the Lobby section.
// No side effects — unlike create-room this must never insert a room, so the
// Lobby can render the section on every mount.
async function handleActiveRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }

  const existing = await selectActiveRoom(session.row.user_id)
  if (!existing.ok) {
    // A failed lookup is a loud 500 (rule 12), never a silent empty state.
    return json({ error: 'active room lookup failed' }, 500, headers)
  }
  return json(
    activeRoomDecision({ userId: session.row.user_id, room: existing.row }).body,
    200,
    headers,
  )
}

// CYJ-34: read-only list of the rooms the caller JOINED but does not host —
// the Lobby's "Rooms you've joined" section. Mirrors handleActiveRoom step
// for step: session resolution → lookup (a failure is a loud 500, never a
// fake empty list) → decision layer (the host exclusion and the 200 shape
// live there, Vitest-covered). Read-only: it must never insert, so the Lobby
// can render the section on every mount.
async function handleJoinedRooms(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }

  const selected = await selectJoinedRooms(session.row.user_id)
  if (!selected.ok) {
    return json({ error: 'joined rooms lookup failed' }, 500, headers)
  }
  const memberships: JoinedMembershipRow[] = selected.rows.map((row) => ({
    isHost: row.is_host,
    room: {
      id: row.rooms.id,
      code: row.rooms.code,
      name: row.rooms.name,
      players: row.rooms.room_players.map((p) => ({
        isHost: p.is_host,
        displayName: p.users?.display_name ?? null,
      })),
    },
  }))
  const decision = joinedRoomsDecision({ userId: session.row.user_id, memberships })
  return json(decision.body, decision.status, headers)
}

// CYJ-24: read-only room detail for the WaitingRoom — the room row plus
// exactly its room_players (no fixture fallback anywhere). Public read: the
// room code is shareable by design, so no session is required. A failed
// PostgREST lookup is a loud 500 (rule 12); a no-row is the decision layer's
// explicit 404.
//
// Threat model (CYJ-24 review, security): this endpoint is unauthenticated
// and returns every player's userId, display name, and avatar for any room
// id. That is deliberate — room links must work for invited players without
// a session — and is bounded by UUID unguessability (no room-id listing
// exists; room codes are NOT accepted here). If a room-id leak ever becomes
// realistic (referrer headers, logs, a future listing endpoint), revisit:
// require the room code as a second factor, or authenticate. Player identity
// is further bounded by getRoomDecision: no email ever reaches the response
// (display_name falls back to 'Player') and avatar URLs must be https:.
async function handleGetRoom(roomId: string): Promise<Response> {
  const headers = withCors(new Headers())
  const selected = await selectRoomWithPlayers(roomId)
  if (!selected.ok) {
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const row = selected.row
  const decision = getRoomDecision({
    room: row
      ? {
          id: row.id,
          code: row.code,
          name: row.name,
          status: row.status,
          // CYJ-28 review (round 1): the client derives editability from this —
          // the same owner_id the update-room path enforces — so the two
          // definitions of 'host' cannot drift apart.
          ownerId: row.owner_id,
          maxPlayers: row.max_players,
          // CYJ-28: the settings columns ride this response so the settings
          // screen is fed by this single GET (AC #1 forbids a second call).
          rule: row.rule,
          turnSeconds: row.turn_seconds,
          winCondition: row.win_condition,
          dictionary: row.dictionary,
        }
      : null,
    players: (row?.room_players ?? []).map(
      (p): RoomPlayerRow => ({
        userId: p.user_id,
        isHost: p.is_host,
        displayName: p.users?.display_name ?? null,
        avatarUrl: p.users?.avatar_url ?? null,
      }),
    ),
  })
  return json(decision.body, decision.status, headers)
}

// CYJ-31: the join-by-code lookup. Public read — a room code is shareable by
// design, and the response carries only {roomId, code} (less identity than the
// existing GET /room/<id>), so no session is required; brute-force is bounded
// by 32^6 ≈ 1.07B codes (CYJ-24's read-routes convention: unthrottled).
// Malformed codes skip the PostgREST round trip and are the decision layer's
// 400; an affirmative no-row is its 404 (AC #4); only a failed PostgREST
// lookup is this transport's loud 500 (CYJ-23), never a fake 404.
async function handleLookupByCode(code: string): Promise<Response> {
  const headers = withCors(new Headers())
  const selected = isWellFormedRoomCode(code)
    ? await selectRoomIdByCode(code)
    : { ok: true as const, row: null }
  if (!selected.ok) {
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const decision = lookupRoomByCodeDecision({ code, room: selected.row })
  return json(decision.body, decision.status, headers)
}

// CYJ-23: close (not delete) — the row stays, status becomes 'closed', and
// the partial unique index then lets the owner create a fresh room (AC #7).
// Ownership is enforced by the decision layer BEFORE the PATCH runs: select,
// compare owner_id, and only then write.
async function handleCloseRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  // Auth boundary first, same as create-room: a session-less caller gets 401
  // regardless of body shape.
  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }
  const userId = session.row.user_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400, headers)
  }
  const parsed = parseCloseRoomBody(body)
  if (!parsed.ok) {
    return json({ error: parsed.reason }, 400, headers)
  }

  const selected = await selectRoomById(parsed.roomId)
  if (!selected.ok) {
    console.error(`room-authority: close-room lookup failed for room ${parsed.roomId}`)
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const decision = closeRoomDecision({ userId, room: selected.row })
  if (decision.status !== 200) {
    return json(decision.body, decision.status, headers)
  }

  // CYJ-23 review (round 2, functional): the close throttle counts only
  // requests that passed auth, body validation, and the ownership decision —
  // so 400/403/404 responses never drain the owner's budget and a caller
  // hammering invalid closes can't 429 the owner out of closing their
  // actual room for the window.
  if (writeThrottled(closeHits, userId, CLOSE_MAX_PER_WINDOW)) {
    return json({ error: 'too many close requests, try again in a minute' }, 429, headers)
  }

  // Idempotent: an already-closed room skips the write (the decision layer
  // returned 200 for the owner either way).
  if (selected.row?.status !== 'closed') {
    // CYJ-23 review (round 2, security): defense-in-depth — the PATCH
    // predicate repeats the ownership check so PostgREST itself refuses the
    // write if owner_id changed between the SELECT and the PATCH (a stale
    // read alone can never authorize a write). userId is server-derived
    // (session row), so it needs no encoding; roomId is client-supplied and
    // is encoded above.
    const patched = await rest(
      `/rooms?id=eq.${encodeURIComponent(parsed.roomId)}&owner_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'closed' }),
      },
    )
    if (!patched.ok) {
      console.error(
        `room-authority: close-room PATCH failed: HTTP ${patched.status} ${await patched.text()}`,
      )
      return json({ error: 'room close failed' }, 500, headers)
    }
  }
  return json(decision.body, 200, headers)
}

// CYJ-32: a signed-in non-host removes their own room_players row. Mirrors
// handleCloseRoom step for step: auth boundary → parse → room select →
// membership select → decision (403 before any write) → post-decision
// throttle → DELETE. The DELETE predicate repeats room_id + user_id so
// PostgREST itself refuses to touch any other row; the host check is the
// decision layer's job (a host's DELETE can never run — defense in depth:
// the client never sends it).
async function handleLeaveRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  // Auth boundary first, same as the other write routes: a session-less
  // caller gets 401 regardless of body shape.
  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }
  const userId = session.row.user_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400, headers)
  }
  const parsed = parseLeaveRoomBody(body)
  if (!parsed.ok) {
    return json({ error: parsed.reason }, 400, headers)
  }

  const selected = await selectRoomById(parsed.roomId)
  if (!selected.ok) {
    console.error(`room-authority: leave-room lookup failed for room ${parsed.roomId}`)
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const membership = await selectMembership(parsed.roomId, userId)
  if (!membership.ok) {
    console.error(`room-authority: leave-room membership lookup failed for room ${parsed.roomId}`)
    return json({ error: 'membership lookup failed' }, 500, headers)
  }
  const decision = leaveRoomDecision({
    userId,
    room: selected.row,
    membership: membership.row ? { userId: membership.row.user_id, isHost: membership.row.is_host } : null,
  })
  if (decision.status !== 200) {
    return json(decision.body, decision.status, headers)
  }

  // Same throttle discipline as close-room: only requests that passed auth,
  // validation, and the membership decision count against the budget.
  if (writeThrottled(leaveHits, userId, LEAVE_MAX_PER_WINDOW)) {
    return json({ error: 'too many leave requests, try again in a minute' }, 429, headers)
  }

  const deleted = await rest(
    `/room_players?room_id=eq.${encodeURIComponent(parsed.roomId)}&user_id=eq.${userId}`,
    {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    },
  )
  if (!deleted.ok) {
    console.error(`room-authority: leave-room DELETE failed: HTTP ${deleted.status}`)
    return json({ error: 'room leave failed' }, 500, headers)
  }
  // An empty representation (a concurrent leave won the race) is an
  // idempotent 200 — the caller is out of the room either way, never a 500.
  return json(decision.body, 200, headers)
}

// CYJ-33: a signed-in user joins a room — the ONLY writer of non-host
// room_players rows. Mirrors handleLeaveRoom step for step: auth boundary →
// parse → room+players select → decision (401/404/observer/rejoin BEFORE any
// write) → post-decision throttle → INSERT. One PostgREST round trip
// (selectRoomWithPlayers, CYJ-24) yields the room and its players, so the
// membership check and the capacity check derive from the same embedded list
// the decision layer consumes.
//
// Known race (accepted for this ticket, documented in the CYJ-33 proposal):
// the capacity check is select-then-insert across two PostgREST calls with no
// transaction, so two users grabbing the LAST slot concurrently can both
// insert, transiently exceeding max_players by one. Bounded and visible in
// the WaitingRoom count; the unique(room_id, user_id) constraint still
// guarantees no duplicate rows (AC #4) under concurrency. A DB-level cap is
// flagged as follow-up work.
async function handleJoinRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  // Auth boundary first, same as the other write routes: a session-less
  // caller gets 401 regardless of body shape.
  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }
  const userId = session.row.user_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400, headers)
  }
  const parsed = parseJoinRoomBody(body)
  if (!parsed.ok) {
    return json({ error: parsed.reason }, 400, headers)
  }

  const selected = await selectRoomWithPlayers(parsed.roomId)
  if (!selected.ok) {
    console.error(`room-authority: join-room lookup failed for room ${parsed.roomId}`)
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const row = selected.row
  const membershipRow = row?.room_players.find((p) => p.user_id === userId) ?? null
  const decision = joinRoomDecision({
    userId,
    room: row ? { id: row.id, status: row.status, maxPlayers: row.max_players } : null,
    membership: membershipRow
      ? { userId: membershipRow.user_id, isHost: membershipRow.is_host }
      : null,
    playerCount: row?.room_players.length ?? 0,
  })
  if (decision.status !== 200) {
    return json(decision.body, decision.status, headers)
  }
  if (!decision.write) {
    // Idempotent rejoin (AC #4) or full-room observer (AC #6) — no insert.
    return json(decision.body, 200, headers)
  }

  // Same throttle discipline as leave-room: only requests that passed auth,
  // validation, and the membership/capacity decision count against the
  // budget.
  if (writeThrottled(joinHits, userId, JOIN_MAX_PER_WINDOW)) {
    return json({ error: 'too many join requests, try again in a minute' }, 429, headers)
  }

  const inserted = await insertRoomPlayer(parsed.roomId, userId, false)
  if (!inserted.ok) {
    if (inserted.conflict) {
      // A concurrent same-user join won the race — unique(room_id, user_id)
      // fired. Idempotent 200 (AC #4), never a duplicate row.
      return json(decision.body, 200, headers)
    }
    // Loud 500 (rule 12) — never a silent partial join.
    return json({ error: 'room join failed' }, 500, headers)
  }
  return json(decision.body, 200, headers)
}

// CYJ-28: host-only settings persistence. Mirrors handleCloseRoom step for
// step: auth boundary → parse → select → ownership decision (403 before any
// write) → throttle (post-decision only) → PATCH with the owner predicate as
// defense-in-depth (CYJ-23 precedent).
async function handleUpdateRoom(req: Request): Promise<Response> {
  const headers = withCors(new Headers())

  // Auth boundary first, same as the other write routes: a session-less
  // caller gets 401 regardless of body shape.
  const session = await resolveUserId(
    req.headers.get('cookie'),
    req.headers.get('x-cyj-session'),
    lookupSession,
  )
  if (session.kind !== 'ok') {
    return json({ error: 'no session' }, 401, headers)
  }
  const userId = session.row.user_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400, headers)
  }
  const parsed = parseUpdateRoomBody(body)
  if (!parsed.ok) {
    return json({ error: parsed.reason }, 400, headers)
  }

  const selected = await selectRoomById(parsed.roomId)
  if (!selected.ok) {
    console.error(`room-authority: update-room lookup failed for room ${parsed.roomId}`)
    return json({ error: 'room lookup failed' }, 500, headers)
  }
  const decision = updateRoomDecision({ userId, room: selected.row, settings: parsed.settings })
  if (decision.status !== 200) {
    return json(decision.body, decision.status, headers)
  }

  // Same throttle discipline as close-room: only requests that passed auth,
  // validation, and the ownership decision count against the budget.
  if (writeThrottled(updateHits, userId, UPDATE_MAX_PER_WINDOW)) {
    return json({ error: 'too many update requests, try again in a minute' }, 429, headers)
  }

  // Defense-in-depth: the PATCH predicate repeats the ownership check so
  // PostgREST itself refuses the write if owner_id changed between the SELECT
  // and the PATCH. userId is server-derived (session row), so it needs no
  // encoding; roomId is client-supplied and is encoded above.
  const patched = await rest(
    `/rooms?id=eq.${encodeURIComponent(parsed.roomId)}&owner_id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name: parsed.settings.name,
        rule: parsed.settings.rule,
        turn_seconds: parsed.settings.turnSeconds,
        max_players: parsed.settings.maxPlayers,
        win_condition: parsed.settings.winCondition,
        dictionary: parsed.settings.dictionary,
      }),
    },
  )
  if (!patched.ok) {
    console.error(`room-authority: update-room PATCH failed: HTTP ${patched.status}`)
    return json({ error: 'room update failed' }, 500, headers)
  }
  const representation = (await patched.json()) as unknown[]
  if (!Array.isArray(representation) || representation.length === 0) {
    // The owner predicate matched nothing — an ownership change raced the
    // PATCH. Loud 500 (rule 12), never a silent no-op success.
    console.error(`room-authority: update-room PATCH matched no rows for room ${parsed.roomId}`)
    return json({ error: 'room update failed' }, 500, headers)
  }
  return json(decision.body, 200, headers)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!configured) {
    return json({ error: 'room-authority not configured' }, 500, withCors(new Headers()))
  }

  const path = new URL(req.url).pathname
  if (req.method === 'OPTIONS') {
    const headers = withCors(new Headers())
    // CYJ-20: x-cyj-session is a non-simple header on the client's
    // cross-site create-room fetch — without this the browser preflight
    // rejects it and the session never reaches the shared resolver (same
    // allowance /auth/me already carries, auth/index.ts).
    headers.set('Access-Control-Allow-Headers', 'Content-Type, apikey, x-cyj-session')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    return new Response(null, { status: 204, headers })
  }

  // CYJ-23: routing precedes the method gate so GET …/active-room reaches its
  // handler; each write route still enforces POST itself.
  if (path.endsWith('/active-room')) {
    if (req.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
    }
    return handleActiveRoom(req)
  }
  // CYJ-34: GET /room-authority/joined-rooms — same pattern as /active-room:
  // routed before the POST gate, GET enforced here.
  if (path.endsWith('/joined-rooms')) {
    if (req.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
    }
    return handleJoinedRooms(req)
  }
  // CYJ-31: GET /room-authority/room-by-code/<code> — join-by-code lookup.
  // A distinct segment from /room/<id> below: that route is UUID-keyed and its
  // threat model explicitly refuses codes (CYJ-24), so the two contracts never
  // shadow each other.
  const byCodeMatch = path.match(/\/room-authority\/room-by-code\/([^/]+)$/)
  if (byCodeMatch) {
    if (req.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
    }
    return handleLookupByCode(byCodeMatch[1])
  }
  // CYJ-24: GET /room-authority/room/<roomId> — same pattern as /active-room:
  // routed before the POST gate, GET enforced here.
  const roomMatch = path.match(/\/room-authority\/room\/([^/]+)$/)
  if (roomMatch) {
    if (req.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
    }
    return handleGetRoom(roomMatch[1])
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
  }

  if (path.endsWith('/create-room')) return handleCreateRoom(req)
  if (path.endsWith('/close-room')) return handleCloseRoom(req)
  if (path.endsWith('/update-room')) return handleUpdateRoom(req)
  if (path.endsWith('/leave-room')) return handleLeaveRoom(req)
  if (path.endsWith('/join-room')) return handleJoinRoom(req)
  return json({ error: 'not found' }, 404, withCors(new Headers()))
})
