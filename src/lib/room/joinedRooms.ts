/**
 * Joined-rooms read decision layer (CYJ-34). Transport-free so Vitest and the
 * Deno Edge Function share it verbatim (imported with explicit .ts
 * extensions). The Edge Function does session resolution and PostgREST IO;
 * the 401/200 mapping, the host exclusion, and the response shape live here.
 */

export interface JoinedRoomSummary {
  roomId: string
  code: string
  name: string | null
  hostName: string
}

/** One of the caller's room_players rows with its room and the room's players
 *  embedded, as the transport maps PostgREST's nested embed. The host
 *  exclusion (isHost) is decided HERE, not in the query, so the behavior is
 *  Vitest-covered (the transport is Deno-only and untested by convention). */
export interface JoinedMembershipRow {
  isHost: boolean
  room: {
    id: string
    code: string
    name: string | null
    players: { isHost: boolean; displayName: string | null }[]
  }
}

export type JoinedRoomsDecision = {
  status: 200 | 401
  body: { rooms: JoinedRoomSummary[] } | { error: string }
}

/**
 * Maps the joined-rooms read to the HTTP response. Every membership where the
 * caller is NOT the host becomes one summary row; an empty list is a 200 with
 * rooms: [] — an explicit empty state, not an error. The host display name
 * falls back to the neutral 'Player' when display_name is null — never to the
 * user's email (PII), same discipline as getRoom.ts (review-round-1 security
 * precedent).
 */
export function joinedRoomsDecision(args: {
  userId: string | null
  memberships: JoinedMembershipRow[]
}): JoinedRoomsDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  const rooms: JoinedRoomSummary[] = []
  for (const membership of args.memberships) {
    // The AC's exclusion: a room the caller hosts never appears in the
    // joined-rooms list.
    if (membership.isHost) continue
    const host = membership.room.players.find((p) => p.isHost)
    rooms.push({
      roomId: membership.room.id,
      code: membership.room.code,
      name: membership.room.name,
      hostName: host?.displayName ?? 'Player',
    })
  }
  return { status: 200, body: { rooms } }
}
