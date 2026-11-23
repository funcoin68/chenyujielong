import { describe, it, expect } from 'vitest'
import { getRoomDecision } from './getRoom.ts'

const ROOM = { id: 'r-1', code: 'ZZ99ZZ', name: 'My room', status: 'waiting', maxPlayers: 4 }

describe('getRoomDecision', () => {
  it('maps a missing room to 404 (explicit empty state, not an error shape)', () => {
    const decision = getRoomDecision({ room: null, players: [] })
    expect(decision.status).toBe(404)
    expect(decision.body).toEqual({ error: 'room not found' })
  })

  it('maps the room and its players to 200 with id, code, name, status and maxPlayers', () => {
    const decision = getRoomDecision({
      room: ROOM,
      players: [
        { userId: 'u-1', isHost: true, displayName: 'Host', avatarUrl: 'https://x.test/a.png', email: 'h@x.test' },
        { userId: 'u-2', isHost: false, displayName: 'Guest', avatarUrl: null, email: 'g@x.test' },
      ],
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({
      room: { roomId: 'r-1', code: 'ZZ99ZZ', name: 'My room', status: 'waiting', maxPlayers: 4 },
      players: [
        { userId: 'u-1', name: 'Host', avatarUrl: 'https://x.test/a.png', isHost: true },
        { userId: 'u-2', name: 'Guest', avatarUrl: null, isHost: false },
      ],
    })
  })

  it('falls back to the email when display_name is null', () => {
    const decision = getRoomDecision({
      room: ROOM,
      players: [{ userId: 'u-1', isHost: true, displayName: null, avatarUrl: null, email: 'h@x.test' }],
    })
    expect(decision.status).toBe(200)
    const body = decision.body as { players: { name: string }[] }
    expect(body.players[0].name).toBe('h@x.test')
  })

  it('drops avatar URLs that are not https:', () => {
    const decision = getRoomDecision({
      room: ROOM,
      players: [
        { userId: 'u-1', isHost: true, displayName: 'A', avatarUrl: 'javascript:alert(1)', email: 'a@x.test' },
        { userId: 'u-2', isHost: false, displayName: 'B', avatarUrl: 'http://x.test/b.png', email: 'b@x.test' },
      ],
    })
    const body = decision.body as { players: { avatarUrl: string | null }[] }
    expect(body.players[0].avatarUrl).toBeNull()
    expect(body.players[1].avatarUrl).toBeNull()
  })

  it('keeps an https: avatar URL', () => {
    const decision = getRoomDecision({
      room: ROOM,
      players: [{ userId: 'u-1', isHost: true, displayName: 'A', avatarUrl: 'https://x.test/a.png', email: 'a@x.test' }],
    })
    const body = decision.body as { players: { avatarUrl: string | null }[] }
    expect(body.players[0].avatarUrl).toBe('https://x.test/a.png')
  })
})
