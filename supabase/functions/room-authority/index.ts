// room-authority: the ONLY writer to the rooms table (CYJ-17).
// Transport only — decision logic lives in src/lib/room/ (see
// supabase/functions/README.md): this file owns env checks, session-cookie
// resolution, PostgREST IO, and HTTP responses; src/lib/room/ owns every
// branch decision (400/401/200/500 mapping).
import { generateRoomCode } from '../../../src/lib/room/code.ts'
import { createRoomDecision, parseCreateRoomBody } from '../../../src/lib/room/createRoom.ts'
import type { RoomSettingsInput } from '../../../src/lib/room/createRoom.ts'
import { activeRoomDecision } from '../../../src/lib/room/activeRoom.ts'
import { closeRoomDecision, parseCloseRoomBody } from '../../../src/lib/room/closeRoom.ts'
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
const createHits = new Map<string, number[]>()
const closeHits = new Map<string, number[]>()

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

  const inserted = await insertRoom(userId, parsed.settings)
  if (inserted.row) {
    return json(createRoomDecision({ userId, created: inserted.row }).body, 200, headers)
  }
  if (inserted.conflict) {
    // Re-select after the 409: the index guarantees exactly one active row
    // now exists, so this returns the winner's room with 200 (AC #2/#3).
    const winner = await selectActiveRoom(userId)
    if (winner.ok && winner.row) {
      return json(createRoomDecision({ userId, room: winner.row }).body, 200, headers)
    }
  }
  // Non-409 insert failure, or a lost 409 race that broke the index
  // invariant — fail loudly (rule 12), never silently.
  return json(createRoomDecision({ userId, room: null }).body, 500, headers)
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
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
  }

  if (path.endsWith('/create-room')) return handleCreateRoom(req)
  if (path.endsWith('/close-room')) return handleCloseRoom(req)
  return json({ error: 'not found' }, 404, withCors(new Headers()))
})
