/**
 * Client for the room-authority Edge Function (CYJ-17). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { FUNCTIONS_URL } from '../config'
import { readSessionToken } from '../auth/sessionToken'
import type { ActiveRoomSummary } from '../lib/room/activeRoom.ts'

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
