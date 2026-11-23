/**
 * Create-room decision layer (CYJ-17). Transport-free so Vitest and the Deno
 * Edge Function share it verbatim (imported with explicit .ts extensions).
 * The Edge Function does session resolution and PostgREST IO; every branch
 * decision (400/401/200-existing/200-created/500) lives here.
 */

export interface RoomSettingsInput {
  name: string
  rule: 'strict' | 'homophone'
  turnSeconds: number
  maxPlayers: number
  winCondition: 'rounds' | 'elimination'
  dictionary: 'common' | 'full'
}

const RULES = ['strict', 'homophone'] as const
const WIN_CONDITIONS = ['rounds', 'elimination'] as const
const DICTIONARIES = ['common', 'full'] as const
const MAX_NAME_LENGTH = 24

export type ParseCreateRoomBodyResult =
  | { ok: true; settings: RoomSettingsInput }
  | { ok: false; reason: string }

export type ParseRoomSettingsFieldsResult =
  | { ok: true; settings: RoomSettingsInput }
  | { ok: false; reason: string }

/**
 * Validates just the settings fields (name, rule, turnSeconds, maxPlayers,
 * winCondition, dictionary). CYJ-28: extracted from parseCreateRoomBody so
 * create-room and update-room share ONE copy of the CHECK-constraint rules —
 * two copies would drift (rule 7).
 */
export function parseRoomSettingsFields(body: Record<string, unknown>): ParseRoomSettingsFieldsResult {
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return { ok: false, reason: 'name must be a non-empty string' }
  }
  if (body.name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `name must be at most ${MAX_NAME_LENGTH} characters` }
  }
  if (!isOneOf(body.rule, RULES)) {
    return { ok: false, reason: `rule must be one of: ${RULES.join(', ')}` }
  }
  if (!isPositiveInt(body.turnSeconds)) {
    return { ok: false, reason: 'turnSeconds must be a positive integer' }
  }
  if (!isPositiveInt(body.maxPlayers) || body.maxPlayers < 2 || body.maxPlayers > 6) {
    return { ok: false, reason: 'maxPlayers must be an integer between 2 and 6' }
  }
  if (!isOneOf(body.winCondition, WIN_CONDITIONS)) {
    return { ok: false, reason: `winCondition must be one of: ${WIN_CONDITIONS.join(', ')}` }
  }
  if (!isOneOf(body.dictionary, DICTIONARIES)) {
    return { ok: false, reason: `dictionary must be one of: ${DICTIONARIES.join(', ')}` }
  }

  return {
    ok: true,
    settings: {
      name: body.name.trim(),
      rule: body.rule,
      turnSeconds: body.turnSeconds,
      maxPlayers: body.maxPlayers,
      winCondition: body.winCondition,
      dictionary: body.dictionary,
    },
  }
}

/**
 * Validates the create-room request body. Mirrors validateMove.ts: malformed
 * input and out-of-range settings are both 400, never a silent default.
 */
export function parseCreateRoomBody(input: unknown): ParseCreateRoomBodyResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'request body must be a JSON object' }
  }
  return parseRoomSettingsFields(input as Record<string, unknown>)
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export type CreateRoomDecision = {
  status: 200 | 401 | 500
  body:
    | { roomId: string; code: string; alreadyExisted: boolean }
    | { error: string }
}

/**
 * Maps the create-room outcome to the HTTP response. `room` is the owner's
 * current active room (status <> 'closed'), if any; `created` is the freshly
 * inserted row on the insert-success path only.
 *
 * The 500 branch is only reachable when an insert failed with the partial
 * unique index's 409 and the guaranteed-to-exist re-select found nothing —
 * an invariant violation, surfaced loudly (rule 12), never silently retried.
 */
export function createRoomDecision(args: {
  userId: string | null
  room: { id: string; code: string } | null
  created?: { id: string; code: string }
}): CreateRoomDecision {
  if (args.userId === null) {
    return { status: 401, body: { error: 'no session' } }
  }
  if (args.room) {
    return {
      status: 200,
      body: { roomId: args.room.id, code: args.room.code, alreadyExisted: true },
    }
  }
  if (args.created) {
    return {
      status: 200,
      body: { roomId: args.created.id, code: args.created.code, alreadyExisted: false },
    }
  }
  return { status: 500, body: { error: 'room creation failed' } }
}
