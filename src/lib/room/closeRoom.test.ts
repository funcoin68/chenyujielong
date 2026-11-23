import { describe, it, expect } from 'vitest'
import { parseCloseRoomBody, closeRoomDecision } from './closeRoom.ts'

describe('parseCloseRoomBody', () => {
  it('accepts a well-formed body with a non-empty roomId', () => {
    expect(parseCloseRoomBody({ roomId: 'r-1' })).toEqual({ ok: true, roomId: 'r-1' })
  })

  it('rejects a non-object body with 400 + reason', () => {
    for (const bad of [null, 'room', 42, [1, 2]]) {
      const parsed = parseCloseRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects a missing, non-string, or empty roomId with 400 + reason', () => {
    for (const bad of [{}, { roomId: 42 }, { roomId: '' }, { roomId: '   ' }]) {
      const parsed = parseCloseRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })
})

describe('closeRoomDecision', () => {
  it('maps no user to 401 before looking at the room (auth boundary first)', () => {
    const decision = closeRoomDecision({
      userId: null,
      room: { id: 'r-1', owner_id: 'u-1', status: 'waiting' },
    })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('maps a missing room to 404 and does not change status', () => {
    const decision = closeRoomDecision({ userId: 'u-1', room: null })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room not found' })
  })

  it('maps a non-owner to 403 and the room status is unchanged', () => {
    const room = { id: 'r-1', owner_id: 'u-2', status: 'waiting' }
    const decision = closeRoomDecision({ userId: 'u-1', room })
    expect(decision.status).toBe(403)
    expect(decision.body).toEqual({ error: 'not the room owner' })
    expect(room.status).toBe('waiting')
  })

  it('maps the owner to 200 with status closed', () => {
    const decision = closeRoomDecision({
      userId: 'u-1',
      room: { id: 'r-1', owner_id: 'u-1', status: 'waiting' },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', status: 'closed' })
  })

  it('maps an owner re-closing an already-closed room to 200 (idempotent)', () => {
    const decision = closeRoomDecision({
      userId: 'u-1',
      room: { id: 'r-1', owner_id: 'u-1', status: 'closed' },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', status: 'closed' })
  })
})
