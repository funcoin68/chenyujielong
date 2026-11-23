/**
 * Client for the room-authority Edge Function (CYJ-17). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { FUNCTIONS_URL } from '../config'
import { readSessionToken } from '../auth/sessionToken'

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
