import { describe, it, expect } from 'vitest'
import { parseUpdateRoomBody, updateRoomDecision } from './updateRoom.ts'

const VALID_SETTINGS = {
  name: 'My Room',
  rule: 'strict',
  turnSeconds: 30,
  maxPlayers: 4,
  winCondition: 'rounds',
  dictionary: 'common',
} as const

describe('parseUpdateRoomBody', () => {
  it('accepts a well-formed body with a roomId and every settings field', () => {
    const parsed = parseUpdateRoomBody({ roomId: 'r-1', ...VALID_SETTINGS })
    expect(parsed).toEqual({ ok: true, roomId: 'r-1', settings: { ...VALID_SETTINGS } })
  })

  it('rejects a non-object body with 400 + reason', () => {
    for (const bad of [null, 'room', 42, [1, 2]]) {
      const parsed = parseUpdateRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects a missing, non-string, or empty roomId with 400 + reason', () => {
    for (const bad of [{ ...VALID_SETTINGS }, { roomId: 42, ...VALID_SETTINGS }, { roomId: '', ...VALID_SETTINGS }]) {
      const parsed = parseUpdateRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects invalid settings fields with 400 + reason (same rules as create-room)', () => {
    for (const bad of [
      { roomId: 'r-1', ...VALID_SETTINGS, name: '' },
      { roomId: 'r-1', ...VALID_SETTINGS, name: 'x'.repeat(25) },
      { roomId: 'r-1', ...VALID_SETTINGS, rule: 'lax' },
      { roomId: 'r-1', ...VALID_SETTINGS, turnSeconds: 0 },
      { roomId: 'r-1', ...VALID_SETTINGS, turnSeconds: 1.5 },
      { roomId: 'r-1', ...VALID_SETTINGS, maxPlayers: 1 },
      { roomId: 'r-1', ...VALID_SETTINGS, maxPlayers: 7 },
      { roomId: 'r-1', ...VALID_SETTINGS, winCondition: 'first-to-ten' },
      { roomId: 'r-1', ...VALID_SETTINGS, dictionary: 'all' },
    ]) {
      const parsed = parseUpdateRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })
})

describe('updateRoomDecision', () => {
  it('maps no user to 401 before looking at the room (auth boundary first)', () => {
    const decision = updateRoomDecision({
      userId: null,
      room: { id: 'r-1', owner_id: 'u-1' },
      settings: { ...VALID_SETTINGS },
    })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('maps a missing room to 404', () => {
    const decision = updateRoomDecision({
      userId: 'u-1',
      room: null,
      settings: { ...VALID_SETTINGS },
    })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room not found' })
  })

  // AC #6 (server-side enforcement): a non-host with a syntactically valid
  // payload gets 403 and the room is untouched — the write never happens.
  it('maps a non-owner with a valid payload to 403 and leaves the room unchanged', () => {
    const room = { id: 'r-1', owner_id: 'u-2', name: 'Old name' }
    const decision = updateRoomDecision({
      userId: 'u-1',
      room,
      settings: { ...VALID_SETTINGS, name: 'Hijacked' },
    })
    expect(decision.status).toBe(403)
    expect(decision.body).toEqual({ error: 'not the room owner' })
    expect(room.name).toBe('Old name')
  })

  it('maps the owner to 200 with the roomId and settings echoed', () => {
    const decision = updateRoomDecision({
      userId: 'u-1',
      room: { id: 'r-1', owner_id: 'u-1' },
      settings: { ...VALID_SETTINGS },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', settings: { ...VALID_SETTINGS } })
  })
})
