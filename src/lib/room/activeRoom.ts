/**
 * Active-room read decision layer (CYJ-23). Transport-free so Vitest and the
 * Deno Edge Function share it verbatim (imported with explicit .ts
 * extensions). The Edge Function does session resolution and PostgREST IO;
 * the 401/200 mapping and the response shape live here.
 */

export interface ActiveRoomSummary {
  roomId: string
  code: string
  name: string | null
  status: 'waiting' | 'in_progress' | 'closed'
}

export type ActiveRoomDecision = {
  status: 200 | 401
  body: { room: ActiveRoomSummary | null } | { error: string }
}

/**
 * Maps the active-room read to the HTTP response. `room` is the caller's
 * current non-closed room (the query filters `status <> 'closed'`), or null
 * when they have none — an explicit empty state, not an error.
 */
export function activeRoomDecision(args: {
  userId: string | null
  room: { id: string; code: string; name: string | null; status: string } | null
}): ActiveRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  if (!args.room) {
    return { status: 200, body: { room: null } }
  }
  // The rooms.status CHECK constraint guarantees one of the three values, so
  // this cast cannot produce an out-of-contract status.
  const status = args.room.status as ActiveRoomSummary['status']
  return {
    status: 200,
    body: { room: { roomId: args.room.id, code: args.room.code, name: args.room.name, status } },
  }
}
