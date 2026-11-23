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

/** The room plus its players, as rendered by the WaitingRoom screen. CYJ-28:
 *  also carries the settings columns so the settings screen is fed by the same
 *  single GET (one shape for both screens, rule 11). CYJ-28 review (round 1):
 *  ownerId is the SAME field the server enforces on update-room (rooms.owner_id,
 *  not room_players.is_host), so editability derived from it can never drift
 *  from the authorization decision. */
export interface RoomDetail extends ActiveRoomSummary {
  ownerId: string
  maxPlayers: number
  rule: 'strict' | 'homophone'
  turnSeconds: number
  winCondition: 'rounds' | 'elimination'
  dictionary: 'common' | 'full'
}

/** The player rows joined from room_players + users, as PostgREST embeds them. */
export interface RoomPlayerRow {
  userId: string
  isHost: boolean
  displayName: string | null
  avatarUrl: string | null
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
 * The player name falls back to the neutral 'Player' when display_name is
 * null — never to the user's email: this endpoint is unauthenticated and
 * room links are shared, so email (PII) must not reach the response
 * (review round 1, security). Avatar URLs are accepted only over https: so a
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
    ownerId: string
    maxPlayers: number
    rule: string
    turnSeconds: number
    winCondition: string
    dictionary: string
  } | null
  players: RoomPlayerRow[]
}): GetRoomDecision {
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' } }
  }
  const status = args.room.status as RoomDetail['status']
  // The rooms CHECK constraints guarantee these values (same discipline as
  // status), so these casts cannot produce out-of-contract settings.
  const rule = args.room.rule as RoomDetail['rule']
  const winCondition = args.room.winCondition as RoomDetail['winCondition']
  const dictionary = args.room.dictionary as RoomDetail['dictionary']
  return {
    status: 200,
    body: {
      room: {
        roomId: args.room.id,
        code: args.room.code,
        name: args.room.name,
        status,
        ownerId: args.room.ownerId,
        maxPlayers: args.room.maxPlayers,
        rule,
        turnSeconds: args.room.turnSeconds,
        winCondition,
        dictionary,
      },
      players: args.players.map((p) => ({
        userId: p.userId,
        // display_name is nullable — fall back to a neutral label, never
        // the email (PII) on this unauthenticated endpoint.
        name: p.displayName ?? 'Player',
        avatarUrl: typeof p.avatarUrl === 'string' && p.avatarUrl.startsWith('https:')
          ? p.avatarUrl
          : null,
        isHost: p.isHost,
      })),
    },
  }
}
