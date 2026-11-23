/**
 * Client for the room-authority Edge Function (CYJ-17). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { FUNCTIONS_URL } from '../config'
import { readSessionToken } from '../auth/sessionToken'
import type { ActiveRoomSummary } from '../lib/room/activeRoom.ts'
import type { RoomDetail, RoomPlayerSummary } from '../lib/room/getRoom.ts'

export interface RoomSettingsPayload {
  name: string
  rule: 'strict' | 'homophone'
  turnSeconds: number
  maxPlayers: number
  winCondition: 'rounds' | 'elimination'
  dictionary: 'common' | 'full'
}

export type CreateRoomResult =
  | { kind: 'ok'; roomId: string }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }

/**
 * Persist a new room owned by the signed-in user — or, if the user already
 * owns an active room, return that room's id (the server decides, AC #2).
 * The session cookie rides along (SameSite=None; Secure, CYJ-7). CYJ-20: the
 * stored token also rides as the x-cyj-session header (pattern copied from
 * src/auth/sessionClient.ts) — browsers blocking third-party cookies never
 * send the cross-site cookie, and the header is the only channel that
 * reaches room-authority there; the server still prefers the cookie when
 * both arrive.
 *
 * The "functions configured?" guard lives HERE (one home, same as
 * src/auth/sessionClient.ts): a missing FUNCTIONS_URL is a visible error,
 * not a silently swallowed fetch (rule 12).
 */
export async function createRoom(settings: RoomSettingsPayload): Promise<CreateRoomResult> {
  if (!FUNCTIONS_URL) return { kind: 'error', message: 'game server is not configured' }
  const token = readSessionToken()
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/room-authority/create-room`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-cyj-session': token } : {}),
      },
      body: JSON.stringify(settings),
    })
  } catch (err) {
    return { kind: 'error', message: `network error: ${String(err)}` }
  }
  if (res.status === 401) {
    await res.body?.cancel()
    return { kind: 'unauthorized' }
  }
  let body: { roomId?: unknown; error?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }
  if (!res.ok) {
    const detail = typeof body.error === 'string' ? `: ${body.error}` : ` (HTTP ${res.status})`
    return { kind: 'error', message: `could not create room${detail}` }
  }
  if (typeof body.roomId !== 'string' || body.roomId === '') {
    return { kind: 'error', message: 'game server returned an invalid response' }
  }
  return { kind: 'ok', roomId: body.roomId }
}

/**
 * The caller's active (non-closed) room, as rendered by the Lobby section.
 * Alias of the shared decision-layer contract (ActiveRoomSummary) — one
 * shape, client and Edge Function (rule 11).
 */
export type ActiveRoom = ActiveRoomSummary

export type FetchActiveRoomResult =
  | { kind: 'ok'; room: ActiveRoom | null }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }

/**
 * CYJ-23: read the signed-in user's active room for the Lobby's "Your active
 * room" section. Read-only — unlike createRoom this never writes. Same
 * transport pattern as createRoom (cookie + x-cyj-session fallback); a null
 * room is a normal empty state, not an error.
 */
export async function fetchActiveRoom(): Promise<FetchActiveRoomResult> {
  if (!FUNCTIONS_URL) return { kind: 'error', message: 'game server is not configured' }
  const token = readSessionToken()
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/room-authority/active-room`, {
      credentials: 'include',
      headers: token ? { 'x-cyj-session': token } : {},
    })
  } catch (err) {
    return { kind: 'error', message: `network error: ${String(err)}` }
  }
  if (res.status === 401) {
    await res.body?.cancel()
    return { kind: 'unauthorized' }
  }
  let body: { room?: unknown; error?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }
  if (!res.ok) {
    const detail = typeof body.error === 'string' ? `: ${body.error}` : ` (HTTP ${res.status})`
    return { kind: 'error', message: `could not load active room${detail}` }
  }
  if (body.room === null) {
    return { kind: 'ok', room: null }
  }
  if (typeof body.room !== 'object' || body.room === null) {
    return { kind: 'error', message: 'game server returned an invalid response' }
  }
  const room = body.room as Record<string, unknown>
  const status = room.status
  if (
    typeof room.roomId !== 'string' ||
    room.roomId === '' ||
    typeof room.code !== 'string' ||
    room.code === '' ||
    (typeof room.name !== 'string' && room.name !== null) ||
    (status !== 'waiting' && status !== 'in_progress' && status !== 'closed')
  ) {
    return { kind: 'error', message: 'game server returned an invalid response' }
  }
  return { kind: 'ok', room: { roomId: room.roomId, code: room.code, name: room.name, status } }
}

export type FetchRoomResult =
  | { kind: 'ok'; room: RoomDetail; players: RoomPlayerSummary[] }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

/**
 * CYJ-24: read one room (with its players) for the WaitingRoom. Public read —
 * the room code is shareable by design — so no session is required; the
 * stored token still rides as x-cyj-session when present (harmless, and
 * future-proofs the endpoint if it ever needs identity). Same transport
 * pattern as fetchActiveRoom; a 404 is a DISTINCT result so the screen can
 * render an explicit "Room not found." empty state (AC #5), never fixture
 * data on any failure path.
 */
export async function fetchRoom(roomId: string): Promise<FetchRoomResult> {
  if (!FUNCTIONS_URL) return { kind: 'error', message: 'game server is not configured' }
  const token = readSessionToken()
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/room-authority/room/${encodeURIComponent(roomId)}`, {
      credentials: 'include',
      headers: token ? { 'x-cyj-session': token } : {},
    })
  } catch (err) {
    return { kind: 'error', message: `network error: ${String(err)}` }
  }
  if (res.status === 404) {
    await res.body?.cancel()
    return { kind: 'not-found' }
  }
  let body: { room?: unknown; players?: unknown; error?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }
  if (!res.ok) {
    const detail = typeof body.error === 'string' ? `: ${body.error}` : ` (HTTP ${res.status})`
    return { kind: 'error', message: `could not load room${detail}` }
  }
  const room = body.room
  const players = body.players
  if (typeof room !== 'object' || room === null || !Array.isArray(players)) {
    return { kind: 'error', message: 'game server returned an invalid response' }
  }
  const r = room as Record<string, unknown>
  if (
    typeof r.roomId !== 'string' ||
    r.roomId === '' ||
    typeof r.code !== 'string' ||
    r.code === '' ||
    (typeof r.name !== 'string' && r.name !== null) ||
    (r.status !== 'waiting' && r.status !== 'in_progress' && r.status !== 'closed') ||
    typeof r.maxPlayers !== 'number' ||
    // CYJ-28: the settings columns ride this response (one GET feeds both the
    // WaitingRoom and the settings screen), so they are required here — an old
    // function without them fails loudly as 'invalid response', never with
    // fixture data (rule 12).
    (r.rule !== 'strict' && r.rule !== 'homophone') ||
    typeof r.turnSeconds !== 'number' ||
    (r.winCondition !== 'rounds' && r.winCondition !== 'elimination') ||
    (r.dictionary !== 'common' && r.dictionary !== 'full')
  ) {
    return { kind: 'error', message: 'game server returned an invalid response' }
  }
  const parsedPlayers: RoomPlayerSummary[] = []
  for (const p of players) {
    if (typeof p !== 'object' || p === null) {
      return { kind: 'error', message: 'game server returned an invalid response' }
    }
    const player = p as Record<string, unknown>
    if (
      typeof player.userId !== 'string' ||
      player.userId === '' ||
      typeof player.name !== 'string' ||
      player.name === '' ||
      (typeof player.avatarUrl !== 'string' && player.avatarUrl !== null) ||
      typeof player.isHost !== 'boolean'
    ) {
      return { kind: 'error', message: 'game server returned an invalid response' }
    }
    parsedPlayers.push({
      userId: player.userId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      isHost: player.isHost,
    })
  }
  return {
    kind: 'ok',
    room: {
      roomId: r.roomId,
      code: r.code,
      name: r.name,
      status: r.status,
      maxPlayers: r.maxPlayers,
      rule: r.rule,
      turnSeconds: r.turnSeconds,
      winCondition: r.winCondition,
      dictionary: r.dictionary,
    },
    players: parsedPlayers,
  }
}

export type CloseRoomResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

/**
 * CYJ-23: close a room the signed-in user owns. The server sets the row's
 * status to 'closed' (the row is kept, so history survives); a non-owner gets
 * 403 and the room is unchanged. After a close the owner can create a fresh
 * room — closed rows don't count against the one-active-room index.
 */
export async function closeRoom(roomId: string): Promise<CloseRoomResult> {
  if (!FUNCTIONS_URL) return { kind: 'error', message: 'game server is not configured' }
  const token = readSessionToken()
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/room-authority/close-room`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-cyj-session': token } : {}),
      },
      body: JSON.stringify({ roomId }),
    })
  } catch (err) {
    return { kind: 'error', message: `network error: ${String(err)}` }
  }
  if (res.status === 401) {
    await res.body?.cancel()
    return { kind: 'unauthorized' }
  }
  if (res.status === 403) {
    await res.body?.cancel()
    return { kind: 'forbidden' }
  }
  if (res.ok) {
    await res.body?.cancel()
    return { kind: 'ok' }
  }
  let body: { error?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }
  const detail = typeof body.error === 'string' ? `: ${body.error}` : ` (HTTP ${res.status})`
  return { kind: 'error', message: `could not close room${detail}` }
}

export type UpdateRoomResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

/**
 * CYJ-28: persist a room's settings — host-only (the server returns 403 for
 * non-hosts even with a valid payload, so a guest's Save can never land). Same
 * transport as closeRoom (cookie + x-cyj-session fallback); a failure leaves
 * the caller's form state untouched, so no edit is ever lost silently.
 */
export async function updateRoom(
  roomId: string,
  settings: RoomSettingsPayload,
): Promise<UpdateRoomResult> {
  if (!FUNCTIONS_URL) return { kind: 'error', message: 'game server is not configured' }
  const token = readSessionToken()
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/room-authority/update-room`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-cyj-session': token } : {}),
      },
      body: JSON.stringify({ roomId, ...settings }),
    })
  } catch (err) {
    return { kind: 'error', message: `network error: ${String(err)}` }
  }
  if (res.status === 401) {
    await res.body?.cancel()
    return { kind: 'unauthorized' }
  }
  if (res.status === 403) {
    await res.body?.cancel()
    return { kind: 'forbidden' }
  }
  if (res.ok) {
    await res.body?.cancel()
    return { kind: 'ok' }
  }
  let body: { error?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body — fall through to the status-based message */
  }
  const detail = typeof body.error === 'string' ? `: ${body.error}` : ` (HTTP ${res.status})`
  return { kind: 'error', message: `could not update room${detail}` }
}
