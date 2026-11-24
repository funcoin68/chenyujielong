/**
 * Leave-room decision layer (CYJ-32). Transport-free so Vitest and the Deno
 * Edge Function share it verbatim (imported with explicit .ts extensions).
 * The Edge Function does session resolution and PostgREST IO; the
 * 401/404/403/200 mapping and the security-critical membership/host checks
 * live here. Mirrors closeRoom.ts (CYJ-23).
 */

export type ParseLeaveRoomBodyResult =
  | { ok: true; roomId: string }
  | { ok: false; reason: string }

/** Validates the leave-room request body. Mirrors parseCloseRoomBody. */
export function parseLeaveRoomBody(input: unknown): ParseLeaveRoomBodyResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'request body must be a JSON object' }
  }
  const body = input as Record<string, unknown>
  if (typeof body.roomId !== 'string' || body.roomId.trim() === '') {
    return { ok: false, reason: 'roomId must be a non-empty string' }
  }
  return { ok: true, roomId: body.roomId.trim() }
}

export type LeaveRoomDecision = {
  status: 200 | 401 | 403 | 404
  body: { roomId: string; left: true } | { error: string }
}

/**
 * Maps the leave-room outcome to the HTTP response. `room` is the row
 * selected by id (null = not found); `membership` is the caller's
 * room_players row (null = not in the room). Membership and host-ness are
 * checked BEFORE any write happens (the Edge Function DELETEs only after this
 * returns 200), so a non-member — or the host — can never remove anyone's
 * row: 403 leaves the table untouched. There is deliberately no room-status
 * gate: removing yourself from a closed or in-progress room is always safe
 * and desirable.
 */
export function leaveRoomDecision(args: {
  userId: string | null
  room: { id: string; owner_id: string; status: string } | null
  membership: { userId: string; isHost: boolean } | null
}): LeaveRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' } }
  }
  if (!args.membership) {
    return { status: 403, body: { error: 'not a room player' } }
  }
  if (args.membership.isHost) {
    return { status: 403, body: { error: 'the host cannot leave, close the room instead' } }
  }
  return { status: 200, body: { roomId: args.room.id, left: true } }
}
