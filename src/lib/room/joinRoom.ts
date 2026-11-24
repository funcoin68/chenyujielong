/**
 * Join-room decision layer (CYJ-33). Transport-free so Vitest and the Deno
 * Edge Function share it verbatim (imported with explicit .ts extensions).
 * The Edge Function does session resolution and PostgREST IO; the
 * 401/404/200 mapping and the security-critical membership/capacity checks
 * live here. Mirrors leaveRoom.ts (CYJ-32).
 */

export type ParseJoinRoomBodyResult =
  | { ok: true; roomId: string }
  | { ok: false; reason: string }

/** Validates the join-room request body. Mirrors parseLeaveRoomBody. */
export function parseJoinRoomBody(input: unknown): ParseJoinRoomBodyResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'request body must be a JSON object' }
  }
  const body = input as Record<string, unknown>
  if (typeof body.roomId !== 'string' || body.roomId.trim() === '') {
    return { ok: false, reason: 'roomId must be a non-empty string' }
  }
  return { ok: true, roomId: body.roomId.trim() }
}

export type JoinRoomDecision = {
  status: 200 | 401 | 404
  body: { roomId: string; observer?: true } | { error: string }
  /** Whether the transport must run the room_players INSERT. Every non-write
   *  outcome (rejoin, observer, error) is decided here so the Edge Function
   *  can never insert on a path this layer refused — the same discipline as
   *  leaveRoomDecision gating the DELETE. */
  write: boolean
}

/**
 * Maps the join-room outcome to the HTTP response and the write decision.
 * `room` is the row selected by id with its max_players (null = not found);
 * `membership` is the caller's room_players row (null = not in the room);
 * `playerCount` is the room's current row count. The membership check runs
 * BEFORE the capacity check so a rejoin to a full room is still the
 * idempotent 200, never an observer downgrade.
 */
export function joinRoomDecision(args: {
  userId: string | null
  room: { id: string; status: string; maxPlayers: number } | null
  membership: { userId: string; isHost: boolean } | null
  playerCount: number
}): JoinRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' }, write: false }
  }
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' }, write: false }
  }
  if (args.room.status === 'closed') {
    // The expired-code case (AC #5): the close-room confirm promises "the
    // room code will stop working", so a closed room is dead to joins — 404
    // like not-found, and no insert ever runs.
    return { status: 404, body: { error: 'room has closed' }, write: false }
  }
  if (args.membership) {
    // Idempotent rejoin (AC #4): the caller — host or player — already has a
    // room_players row, so no second insert can create a duplicate (the
    // unique(room_id, user_id) constraint backs this under concurrency).
    return { status: 200, body: { roomId: args.room.id }, write: false }
  }
  if (args.playerCount >= args.room.maxPlayers) {
    // AC #6: the room is full — the joiner is still navigated to the room
    // (200) but gets no row; the client derives the observer notice from the
    // same players list + maxPlayers this decision used.
    return { status: 200, body: { roomId: args.room.id, observer: true }, write: false }
  }
  return { status: 200, body: { roomId: args.room.id }, write: true }
}
