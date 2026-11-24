/**
 * Room lookup-by-code decision layer (CYJ-31). Transport-free so Vitest and
 * the Deno Edge Function share it verbatim (imported with explicit .ts
 * extensions). The Edge Function does PostgREST IO; the 400/404/200 mapping
 * lives here, mirroring getRoomDecision (CYJ-24).
 *
 * CYJ-23 discipline: only an AFFIRMATIVE no-row maps to 404 — a failed
 * PostgREST lookup is the transport layer's loud 500, never a fake 404.
 */

import { isWellFormedRoomCode } from './code.ts'

export type LookupRoomByCodeDecision = {
  status: 200 | 400 | 404
  body: { roomId: string; code: string } | { error: string }
}

/**
 * Maps the code lookup to the HTTP response. Returns only {roomId, code} —
 * the join flow needs the id alone, and the smaller payload minimizes the
 * unauthenticated surface (full room+players stays on GET /room/<id>).
 */
export function lookupRoomByCodeDecision(args: {
  code: string
  room: { id: string; code: string } | null
}): LookupRoomByCodeDecision {
  if (!isWellFormedRoomCode(args.code)) {
    return { status: 400, body: { error: 'malformed room code' } }
  }
  if (!args.room) {
    return { status: 404, body: { error: 'no room found for that code' } }
  }
  return { status: 200, body: { roomId: args.room.id, code: args.room.code } }
}
