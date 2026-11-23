import { describe, it, expect } from 'vitest'
import { activeRoomDecision } from './activeRoom.ts'

describe('activeRoomDecision', () => {
  it('maps no user to 401 before looking at the room (auth boundary first)', () => {
    const decision = activeRoomDecision({
      userId: null,
      room: { id: 'r-1', code: 'AB23CD', name: 'My room', status: 'waiting' },
    })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('maps no active room to 200 with room null (explicit empty state)', () => {
    const decision = activeRoomDecision({ userId: 'u-1', room: null })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ room: null })
  })

  it('maps the caller\'s active room to 200 with id, code, name and status', () => {
    const decision = activeRoomDecision({
      userId: 'u-1',
      room: { id: 'r-1', code: 'AB23CD', name: 'My room', status: 'in_progress' },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({
      room: { roomId: 'r-1', code: 'AB23CD', name: 'My room', status: 'in_progress' },
    })
  })
})
