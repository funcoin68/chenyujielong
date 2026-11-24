import { describe, it, expect } from 'vitest'
import { parseCreateRoomBody, createRoomDecision } from './createRoom.ts'

describe('parseCreateRoomBody', () => {
  it('accepts a well-formed settings payload', () => {
    const parsed = parseCreateRoomBody({
      name: "Test Player's room",
      rule: 'strict',
      turnSeconds: 30,
      maxPlayers: 4,
      winCondition: 'rounds',
      dictionary: 'common',
    })
    expect(parsed).toEqual({
      ok: true,
      settings: {
        name: "Test Player's room",
        rule: 'strict',
        turnSeconds: 30,
        maxPlayers: 4,
        winCondition: 'rounds',
        dictionary: 'common',
      },
    })
  })

  it('rejects a non-object body with 400 + reason', () => {
    for (const bad of [null, 'room', 42, [1, 2]]) {
      const parsed = parseCreateRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects out-of-range settings with 400 + reason', () => {
    const base = {
      name: 'x',
      rule: 'strict',
      turnSeconds: 30,
      maxPlayers: 4,
      winCondition: 'rounds',
      dictionary: 'common',
    }
    for (const bad of [
      { ...base, rule: 'lax' },
      { ...base, turnSeconds: 0 },
      { ...base, turnSeconds: -5 },
      { ...base, turnSeconds: 'fast' },
      { ...base, maxPlayers: 1 },
      { ...base, maxPlayers: 7 },
      { ...base, maxPlayers: 2.5 },
      { ...base, winCondition: 'sudden death' },
      { ...base, dictionary: 'obscure' },
      { ...base, name: 123 },
    ]) {
      const parsed = parseCreateRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects an out-of-range name length', () => {
    const parsed = parseCreateRoomBody({
      name: 'x'.repeat(25),
      rule: 'strict',
      turnSeconds: 30,
      maxPlayers: 4,
      winCondition: 'rounds',
      dictionary: 'common',
    })
    expect(parsed.ok).toBe(false)
  })
})

describe('createRoomDecision', () => {
  it('maps no user to 401', () => {
    const decision = createRoomDecision({ userId: null, room: null })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('maps an existing active room to 200 with the same id and alreadyExisted', () => {
    const existing = { id: 'r-existing', code: 'K7M2QP' }
    const decision = createRoomDecision({ userId: 'u-1', room: existing })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-existing', code: 'K7M2QP', alreadyExisted: true })
  })

  it('maps a fresh create to 200 with the new id and alreadyExisted false', () => {
    const decision = createRoomDecision({
      userId: 'u-1',
      room: null,
      created: { id: 'r-new', code: 'AB23CD' },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-new', code: 'AB23CD', alreadyExisted: false })
  })

  it('maps a lost 409 race (re-select after unique violation finds nothing) to a loud 500', () => {
    const decision = createRoomDecision({ userId: 'u-1', room: null })
    expect(decision.status).toBe(500)
    expect(decision.body).toEqual({ error: 'room creation failed' })
  })

  // CYJ-31 AC #3: the bounded code-collision retry exhausted — a duplicate
  // code is rejected as a 4xx from the decision layer, never a 500 or a
  // silent success.
  it('maps a persistent code collision (retry exhausted) to 409', () => {
    const decision = createRoomDecision({ userId: 'u-1', room: null, codeConflict: true })
    expect(decision.status).toBe(409)
    expect(decision.body).toEqual({ error: 'room code in use, please try again' })
  })
})
