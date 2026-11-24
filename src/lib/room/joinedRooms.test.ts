import { describe, it, expect } from 'vitest'
import { joinedRoomsDecision } from './joinedRooms.ts'
import type { JoinedMembershipRow } from './joinedRooms.ts'

const MEMBERSHIP: JoinedMembershipRow = {
  isHost: false,
  room: {
    id: 'r-joined',
    code: 'AB23CD',
    name: 'Chain gang',
    players: [{ isHost: true, displayName: 'Host Han' }],
  },
}

describe('joinedRoomsDecision', () => {
  it('maps no user to 401 before looking at memberships (auth boundary first)', () => {
    const decision = joinedRoomsDecision({ userId: null, memberships: [MEMBERSHIP] })
    expect(decision.status).toBe(401)
    expect(decision.body).toEqual({ error: 'no session' })
  })

  it('includes rooms where the caller is a non-host member', () => {
    const decision = joinedRoomsDecision({ userId: 'u-1', memberships: [MEMBERSHIP] })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({
      rooms: [{ roomId: 'r-joined', code: 'AB23CD', name: 'Chain gang', hostName: 'Host Han' }],
    })
  })

  it('excludes rooms where the caller is the host (host + joined elsewhere sees only the joined room)', () => {
    const hosted: JoinedMembershipRow = {
      isHost: true,
      room: {
        id: 'r-hosted',
        code: 'ZZ99ZZ',
        name: 'My own room',
        players: [{ isHost: true, displayName: 'Test Player' }],
      },
    }
    const decision = joinedRoomsDecision({ userId: 'u-1', memberships: [hosted, MEMBERSHIP] })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({
      rooms: [{ roomId: 'r-joined', code: 'AB23CD', name: 'Chain gang', hostName: 'Host Han' }],
    })
  })

  it('maps an empty membership list to 200 with rooms: [] (explicit empty state)', () => {
    const decision = joinedRoomsDecision({ userId: 'u-1', memberships: [] })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({ rooms: [] })
  })

  it('falls back to Player when the host display_name is null (never email, PII discipline)', () => {
    const decision = joinedRoomsDecision({
      userId: 'u-1',
      memberships: [
        {
          isHost: false,
          room: {
            id: 'r-joined',
            code: 'AB23CD',
            name: null,
            players: [{ isHost: true, displayName: null }],
          },
        },
      ],
    })
    expect(decision.status).toBe(200)
    expect(decision.body).toEqual({
      rooms: [{ roomId: 'r-joined', code: 'AB23CD', name: null, hostName: 'Player' }],
    })
  })
})
