import { describe, it, expect } from 'vitest'
import { parseLeaveRoomBody, leaveRoomDecision } from './leaveRoom.ts'

describe('parseLeaveRoomBody', () => {
  it('accepts a well-formed body with a non-empty roomId', () => {
    expect(parseLeaveRoomBody({ roomId: 'r-1' })).toEqual({ ok: true, roomId: 'r-1' })
  })

  it('rejects a non-object body with 400 + reason', () => {
    for (const bad of [null, 'room', 42, [1, 2]]) {
      const parsed = parseLeaveRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects a missing, non-string, or empty roomId with 400 + reason', () => {
    for (const bad of [{}, { roomId: 42 }, { roomId: '' }, { roomId: '   ' }]) {
      const parsed = parseLeaveRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })
})

describe('leaveRoomDecision', () => {
  const room = { id: 'r-1', owner_id: 'u-1', status: 'waiting' }

  it('maps no user to 401 before looking at the room or membership (auth boundary first)', () => {
    const decision = leaveRoomDecision({ userId: null, room, membership: { userId: 'u-2', isHost: false } })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('maps a missing room to 404', () => {
    const decision = leaveRoomDecision({ userId: 'u-2', room: null, membership: { userId: 'u-2', isHost: false } })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room not found' })
  })

  it('maps a non-member to 403 — the DELETE must never run for a caller with no row', () => {
    const decision = leaveRoomDecision({ userId: 'u-2', room, membership: null })
    expect(decision.status).toBe(403)
    expect(decision.body).toEqual({ error: 'not a room player' })
  })

  it('maps the host to 403 — hosts end the room via close-room, they never leave (AC #3)', () => {
    const decision = leaveRoomDecision({ userId: 'u-1', room, membership: { userId: 'u-1', isHost: true } })
    expect(decision.status).toBe(403)
    expect(decision.body).toEqual({ error: 'the host cannot leave, close the room instead' })
  })

  it('maps a signed-in non-host member to 200 with left: true', () => {
    const decision = leaveRoomDecision({ userId: 'u-2', room, membership: { userId: 'u-2', isHost: false } })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', left: true })
  })

  it('allows leaving a closed room — removing yourself is always safe, no status gate', () => {
    const decision = leaveRoomDecision({
      userId: 'u-2',
      room: { ...room, status: 'closed' },
      membership: { userId: 'u-2', isHost: false },
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', left: true })
  })
})
