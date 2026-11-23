// room-authority: the ONLY writer to the rooms table (CYJ-17).
// Transport only — decision logic lives in src/lib/room/ (see
// supabase/functions/README.md): this file owns env checks, session-cookie
// resolution, PostgREST IO, and HTTP responses; src/lib/room/ owns every
// branch decision (400/401/200/500 mapping).
import { generateRoomCode } from '../../../src/lib/room/code.ts'
import { createRoomDecision, parseCreateRoomBody } from '../../../src/lib/room/createRoom.ts'
import type { RoomSettingsInput } from '../../../src/lib/room/createRoom.ts'
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
}

async function selectActiveRoom(userId: string): Promise<RoomRow | null> {
  const res = await rest(
    `/rooms?owner_id=eq.${userId}&status=neq.closed&select=id,code&order=created_at.desc&limit=1`,
  )
  if (!res.ok) {
    console.error(`room-authority: active-room lookup failed: HTTP ${res.status}`)
    return null
  }
  return ((await res.json()) as RoomRow[])?.[0] ?? null
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
// one-active-room partial unique index already caps abuse per user; this
// in-memory sliding window caps insert churn per authenticated user so a
// fleet of accounts can't flood the rooms table. Checked only on the
// insert path — returning an existing active room (AC #2/#3) never
// throttles. Per-isolate, so it bounds rather than hard-limits; a
// platform-level limit is the eventual follow-up (the auth function has
// none either — convention noted in the review reply).
const CREATE_WINDOW_MS = 60_000
const CREATE_MAX_PER_WINDOW = 5
const createHits = new Map<string, number[]>()

function createThrottled(userId: string, now = Date.now()): boolean {
  const cutoff = now - CREATE_WINDOW_MS
  const hits = (createHits.get(userId) ?? []).filter((t) => t > cutoff)
  if (hits.length >= CREATE_MAX_PER_WINDOW) {
    createHits.set(userId, hits)
    return true
  }
  hits.push(now)
  createHits.set(userId, hits)
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
  if (existing) {
    return json(createRoomDecision({ userId, room: existing }).body, 200, headers)
  }

  if (createThrottled(userId)) {
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
    if (winner) {
      return json(createRoomDecision({ userId, room: winner }).body, 200, headers)
    }
  }
  // Non-409 insert failure, or a lost 409 race that broke the index
  // invariant — fail loudly (rule 12), never silently.
  return json(createRoomDecision({ userId, room: null }).body, 500, headers)
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
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
  }

  if (path.endsWith('/create-room')) return handleCreateRoom(req)
  return json({ error: 'not found' }, 404, withCors(new Headers()))
})
