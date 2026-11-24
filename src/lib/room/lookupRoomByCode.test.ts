import { describe, it, expect } from 'vitest'
import { lookupRoomByCodeDecision } from './lookupRoomByCode.ts'

describe('lookupRoomByCodeDecision (CYJ-31)', () => {
  it('maps a found room to 200 with roomId and code (valid code → join)', () => {
    const decision = lookupRoomByCodeDecision({
      code: 'AB23CD',
      room: { id: 'r-1', code: 'AB23CD' },
    })
    expect(decision).toEqual({ status: 200, body: { roomId: 'r-1', code: 'AB23CD' } })
  })

  it('maps an unknown code (affirmative no-row) to an explicit 404', () => {
    const decision = lookupRoomByCodeDecision({ code: 'K7M2QP', room: null })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'no room found for that code' })
  })

  it('maps malformed codes (empty, short, illegal chars, lowercase) to 400', () => {
    for (const bad of ['', 'ABC', 'AB23C', 'AB23CDE', 'ABC0EF', 'ABCOEF', 'AB1DEF', 'ABIDEF', 'ab23cd']) {
      const decision = lookupRoomByCodeDecision({ code: bad, room: null })
      expect(decision.status).toBe(400)
      expect(decision.body).toEqual({ error: 'malformed room code' })
    }
  })

  // The alphabet check is the schema's contract — a malformed code is 400 even
  // if a row somehow matched, never a 200 on an out-of-contract input.
  it('rejects a malformed code even when a row matched', () => {
    const decision = lookupRoomByCodeDecision({
      code: 'ab23cd',
      room: { id: 'r-1', code: 'AB23CD' },
    })
    expect(decision.status).toBe(400)
  })
})
