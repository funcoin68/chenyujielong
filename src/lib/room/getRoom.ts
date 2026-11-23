/**
 * Room-detail read decision layer (CYJ-24). Transport-free so Vitest and the
 * Deno Edge Function share it verbatim (imported with explicit .ts
 * extensions). The Edge Function does PostgREST IO; the 404/200 mapping and
 * the response shape live here.
 */

import type { ActiveRoomSummary } from './activeRoom.ts'

export interface RoomPlayerSummary {
  userId: string
  name: string
  avatarUrl: string | null
  isHost: boolean
}

/** The room plus its players, as rendered by the WaitingRoom screen. */
export interface RoomDetail extends ActiveRoomSummary {
  maxPlayers: number
}

/** The player rows joined from room_players + users, as PostgREST embeds them. */
export interface RoomPlayerRow {
  userId: string
  isHost: boolean
  displayName: string | null
  avatarUrl: string | null
  email: string
}

export type GetRoomDecision = {
  status: 200 | 404
  body:
    | { room: RoomDetail; players: RoomPlayerSummary[] }
    | { error: string }
}

/**
 * Maps the room read to the HTTP response. `room` is null when no row matched
 * the id — an explicit 404, distinct from a failed PostgREST lookup (which the
 * transport layer surfaces as a loud 500, never as a fake "not found").
 *
 * The player name falls back to the user's email because users.display_name
 * is nullable (pack §3). Avatar URLs are accepted only over https: so a
 * weakened server path can never push an arbitrary scheme into <img src>
 * (same discipline as src/auth/sessionClient.ts). The rooms.status CHECK
 * constraint guarantees one of the three values, so this cast cannot produce
 * an out-of-contract status (same comment as activeRoom.ts).
 */
export function getRoomDecision(args: {
  room: {
    id: string
    code: string
    name: string | null
    status: string
    maxPlayers: number
  } | null
  players: RoomPlayerRow[]
}): GetRoomDecision {
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' } }
  }
  const status = args.room.status as RoomDetail['status']
  return {
    status: 200,
    body: {
      room: {
        roomId: args.room.id,
        code: args.room.code,
        name: args.room.name,
        status,
        maxPlayers: args.room.maxPlayers,
      },
      players: args.players.map((p) => ({
        userId: p.userId,
        // display_name is nullable — email is the guaranteed identity.
        name: p.displayName ?? p.email,
        avatarUrl: typeof p.avatarUrl === 'string' && p.avatarUrl.startsWith('https:')
          ? p.avatarUrl
          : null,
        isHost: p.isHost,
      })),
    },
  }
}
