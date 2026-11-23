/**
 * Close-room decision layer (CYJ-23). Transport-free so Vitest and the Deno
 * Edge Function share it verbatim (imported with explicit .ts extensions).
 * The Edge Function does session resolution and PostgREST IO; the
 * 401/404/403/200 mapping and the security-critical owner check live here.
 */

export type ParseCloseRoomBodyResult =
  | { ok: true; roomId: string }
  | { ok: false; reason: string }

/** Validates the close-room request body. Mirrors parseCreateRoomBody. */
export function parseCloseRoomBody(input: unknown): ParseCloseRoomBodyResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'request body must be a JSON object' }
  }
  const body = input as Record<string, unknown>
  if (typeof body.roomId !== 'string' || body.roomId.trim() === '') {
    return { ok: false, reason: 'roomId must be a non-empty string' }
  }
  return { ok: true, roomId: body.roomId.trim() }
}

export type CloseRoomDecision = {
  status: 200 | 401 | 403 | 404
  body: { roomId: string; status: 'closed' } | { error: string }
}

/**
 * Maps the close-room outcome to the HTTP response. `room` is the row
 * selected by id (null = not found). Ownership is checked BEFORE any write
 * happens (the Edge Function PATCHes only after this returns 200), so a
 * non-owner can never change a room's status — 403 leaves the row untouched.
 * An owner re-closing an already-closed room is idempotent 200.
 */
export function closeRoomDecision(args: {
  userId: string | null
  room: { id: string; owner_id: string; status: string } | null
}): CloseRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' } }
  }
  if (args.room.owner_id !== args.userId) {
    return { status: 403, body: { error: 'not the room owner' } }
  }
  return { status: 200, body: { roomId: args.room.id, status: 'closed' } }
}
