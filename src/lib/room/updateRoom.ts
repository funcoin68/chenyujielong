/**
 * Update-room decision layer (CYJ-28). Transport-free so Vitest and the Deno
 * Edge Function share it verbatim (imported with explicit .ts extensions).
 * The Edge Function does session resolution and PostgREST IO; the
 * 401/404/403/200 mapping and the security-critical owner check live here,
 * mirroring closeRoom.ts.
 */

import { parseRoomSettingsFields } from './createRoom.ts'
import type { RoomSettingsInput } from './createRoom.ts'

export type ParseUpdateRoomBodyResult =
  | { ok: true; roomId: string; settings: RoomSettingsInput }
  | { ok: false; reason: string }

/** Validates the update-room request body. Mirrors parseCloseRoomBody. */
export function parseUpdateRoomBody(input: unknown): ParseUpdateRoomBodyResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'request body must be a JSON object' }
  }
  const body = input as Record<string, unknown>
  if (typeof body.roomId !== 'string' || body.roomId.trim() === '') {
    return { ok: false, reason: 'roomId must be a non-empty string' }
  }
  const settings = parseRoomSettingsFields(body)
  if (!settings.ok) {
    return settings
  }
  return { ok: true, roomId: body.roomId.trim(), settings: settings.settings }
}

export type UpdateRoomDecision = {
  status: 200 | 401 | 403 | 404
  body: { roomId: string; settings: RoomSettingsInput } | { error: string }
}

/**
 * Maps the update-room outcome to the HTTP response. `room` is the row
 * selected by id (null = not found). Ownership is checked BEFORE any write
 * happens (the Edge Function PATCHes only after this returns 200), so a
 * non-host can never change a room's settings — 403 leaves the row untouched.
 */
export function updateRoomDecision(args: {
  userId: string | null
  room: { id: string; owner_id: string } | null
  settings: RoomSettingsInput
}): UpdateRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  if (!args.room) {
    return { status: 404, body: { error: 'room not found' } }
  }
  if (args.room.owner_id !== args.userId) {
    return { status: 403, body: { error: 'not the room owner' } }
  }
  return { status: 200, body: { roomId: args.room.id, settings: args.settings } }
}
