import { describe, it, expect } from 'vitest'
import { parseJoinRoomBody, joinRoomDecision } from './joinRoom.ts'

describe('parseJoinRoomBody', () => {
  it('accepts a well-formed body with a non-empty roomId', () => {
    expect(parseJoinRoomBody({ roomId: 'r-1' })).toEqual({ ok: true, roomId: 'r-1' })
  })

  it('rejects a non-object body with 400 + reason', () => {
    for (const bad of [null, 'room', 42, [1, 2]]) {
      const parsed = parseJoinRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })

  it('rejects a missing, non-string, or empty roomId with 400 + reason', () => {
    for (const bad of [{}, { roomId: 42 }, { roomId: '' }, { roomId: '   ' }]) {
      const parsed = parseJoinRoomBody(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBeTruthy()
    }
  })
})

describe('joinRoomDecision', () => {
  const room = { id: 'r-1', status: 'waiting', maxPlayers: 4 }

  it('maps no user to 401 before looking at the room (auth boundary first)', () => {
    const decision = joinRoomDecision({ userId: null, room, membership: null, playerCount: 1 })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
    expect(decision.write).toBe(false)
  })

  it('maps a missing room to 404 with no write', () => {
    const decision = joinRoomDecision({ userId: 'u-2', room: null, membership: null, playerCount: 0 })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room not found' })
    expect(decision.write).toBe(false)
  })

  it('maps a closed room to 404 with no write — the expired-code case (AC #5)', () => {
    const decision = joinRoomDecision({
      userId: 'u-2',
      room: { ...room, status: 'closed' },
      membership: null,
      playerCount: 1,
    })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room has closed' })
    expect(decision.write).toBe(false)
  })

  it('maps an existing player membership to 200 with write: false — idempotent rejoin (AC #4)', () => {
    const decision = joinRoomDecision({
      userId: 'u-2',
      room,
      membership: { userId: 'u-2', isHost: false },
      playerCount: 2,
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1' })
    expect(decision.write).toBe(false)
  })

  it('maps the host re-entering their own room to 200 with write: false (AC #4)', () => {
    const decision = joinRoomDecision({
      userId: 'u-1',
      room,
      membership: { userId: 'u-1', isHost: true },
      playerCount: 1,
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1' })
    expect(decision.write).toBe(false)
  })

  it('lets an existing member rejoin even when the room is full — membership wins over capacity', () => {
    const decision = joinRoomDecision({
      userId: 'u-2',
      room: { ...room, maxPlayers: 2 },
      membership: { userId: 'u-2', isHost: false },
      playerCount: 2,
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1' })
    expect(decision.write).toBe(false)
  })

  it('maps a full room to 200 observer with write: false — navigate but no row (AC #6)', () => {
    const decision = joinRoomDecision({
      userId: 'u-3',
      room: { ...room, maxPlayers: 3 },
      membership: null,
      playerCount: 3,
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1', observer: true })
    expect(decision.write).toBe(false)
  })

  it('maps a new player joining a room with a free slot to 200 with write: true (AC #1)', () => {
    const decision = joinRoomDecision({ userId: 'u-2', room, membership: null, playerCount: 1 })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ roomId: 'r-1' })
    expect(decision.write).toBe(true)
  })
})
