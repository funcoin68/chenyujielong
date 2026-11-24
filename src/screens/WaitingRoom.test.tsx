// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'
import { ROOM, PLAYERS } from '../mock/data'
import { memoryStorage } from '../auth/memoryStorage'
import { invalidateSessionCache } from '../auth/sessionClient'

// Same harness pattern as Lobby.test.tsx: the functions URL is baked at build
// time, so tests provide one (production sets VITE_FUNCTIONS_URL).
vi.mock('../config', () => ({ FUNCTIONS_URL: 'https://fn.example', SUPABASE_ANON_KEY: 'anon-key' }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

// The real room the stubbed room-authority returns — every assertion about
// rendered content is against THIS payload, and every fixture leak assertion
// is against src/mock/data.ts (ROOM.code, PLAYERS names).
const PAYLOAD = {
  room: {
    roomId: 'r-real-1',
    code: 'ZZ99ZZ',
    name: 'Real Room',
    status: 'waiting',
    ownerId: 'u-host',
    maxPlayers: 4,
    // CYJ-28: the settings columns ride the same GET response (required in the
    // client contract from here on).
    rule: 'strict',
    turnSeconds: 30,
    winCondition: 'rounds',
    dictionary: 'common',
  },
  players: [
    { userId: 'u-host', name: 'Host Han', avatarUrl: null, isHost: true },
    { userId: 'u-guest', name: 'Greta Guest', avatarUrl: 'https://x.test/g.png', isHost: false },
  ],
}

const FIXTURE_PLAYER_NAMES = PLAYERS.map((p) => p.name)

const GUEST_ME = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        user: { id: 'u-guest', email: 'g@x.test', display_name: 'Greta Guest', avatar_url: 'https://x.test/g.png' },
      }),
      { status: 200 },
    ),
  )

const HOST_ME = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ user: { id: 'u-host', email: 'h@x.test', display_name: 'Host Han', avatar_url: null } }),
      { status: 200 },
    ),
  )

const LEAVE_OK = () =>
  Promise.resolve(new Response(JSON.stringify({ roomId: 'r-real-1', left: true }), { status: 200 }))

// Renders outside any <Route> match so navigation targets stay observable:
// the /lobby marker proves a successful leave navigated, the * marker's
// pathname proves a failed leave stayed on /room/:roomId.
function LocationMarker() {
  const { pathname } = useLocation()
  return <div data-testid="location-marker">{pathname}</div>
}

async function renderWaitingRoom(
  route: string,
  handlers: {
    room?: (url: string) => Promise<Response>
    me?: () => Promise<Response>
    leave?: () => Promise<Response>
  } = {},
): Promise<{ container: HTMLElement; roomUrls: string[]; fetchMock: ReturnType<typeof vi.fn> }> {
  const roomUrls: string[] = []
  const fetchMock = vi.fn((url: string | URL) => {
    const urlString = String(url)
    if (urlString.includes('/room-authority/leave-room')) {
      return (handlers.leave ?? LEAVE_OK)()
    }
    if (urlString.includes('/room-authority/room/')) {
      roomUrls.push(urlString)
      return (handlers.room ?? (() =>
        Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }))))(urlString)
    }
    // /auth/me answers the (you)-marker resolution; signed out by default.
    return (handlers.me ?? (() =>
      Promise.resolve(new Response('{"error":"no session"}', { status: 401 }))))()
  })
  vi.stubGlobal('fetch', fetchMock)

  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/room/:roomId" element={<WaitingRoom />} />
          <Route path="/lobby" element={<div>LOBBY_MARKER</div>} />
          <Route path="*" element={<LocationMarker />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  // Flush the microtask queue so the room fetch's state update lands inside
  // act() (same pattern as Lobby.test.tsx).
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return { container, roomUrls, fetchMock }
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // CYJ-26: fetchCurrentUser caches per token — reset so a previous test's
  // cache can't suppress this test's mount-time fetch.
  invalidateSessionCache()
})

describe('WaitingRoom (CYJ-24)', () => {
  it('fetches the room id from the route param', async () => {
    const { roomUrls } = await renderWaitingRoom('/room/r-real-1')
    expect(roomUrls).toHaveLength(1)
    expect(roomUrls[0]).toContain('/room-authority/room/r-real-1')
  })

  it('renders the fetched code and exactly the fetched players — no fixture leak', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1')

    // The code shown is the fetched payload's code…
    expect(container.textContent).toContain(PAYLOAD.room.code)
    // …not the fixture room's code from src/mock/data.ts.
    expect(container.textContent).not.toContain(ROOM.code)
    expect(container.querySelector('[aria-label^="Room code"]')?.getAttribute('aria-label')).toContain(
      PAYLOAD.room.code.split('').join(' '),
    )

    // Exactly the response's players are rendered…
    expect(container.textContent).toContain('Host Han')
    expect(container.textContent).toContain('Greta Guest')
    // …and none of the fixture player names appear.
    for (const name of FIXTURE_PLAYER_NAMES) {
      expect(container.textContent).not.toContain(name)
    }

    // Host chip, count and invite slots all derive from the payload.
    expect(container.textContent).toContain('Players 2/4')
    expect(container.querySelectorAll('.waiting-player--empty')).toHaveLength(2)
    const playerRows = container.querySelectorAll(
      '.waiting-player-list .waiting-player:not(.waiting-player--empty)',
    )
    expect(playerRows).toHaveLength(2)
    expect(playerRows[0].textContent).toContain('HOST')
  })

  it('404: shows a visible "Room not found." alert, never fixture data', async () => {
    const { container } = await renderWaitingRoom('/room/r-missing', {
      room: () => Promise.resolve(new Response('{"error":"room not found"}', { status: 404 })),
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Room not found.')
    expect(container.textContent).not.toContain(ROOM.code)
    for (const name of FIXTURE_PLAYER_NAMES) {
      expect(container.textContent).not.toContain(name)
    }
  })

  it('500: shows a visible alert instead of silently rendering fixtures', async () => {
    const { container } = await renderWaitingRoom('/room/r-broken', {
      room: () => Promise.resolve(new Response('{"error":"room lookup failed"}', { status: 500 })),
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    expect(container.textContent).not.toContain(ROOM.code)
  })

  it('network rejection: shows a visible alert instead of silently rendering fixtures', async () => {
    const { container } = await renderWaitingRoom('/room/r-offline', {
      room: () => Promise.reject(new Error('connection refused')),
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    expect(container.textContent).not.toContain(ROOM.code)
  })

  it('marks the signed-in caller with (you) when their id is among the players', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1', {
      me: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: 'u-host', email: 'h@x.test', display_name: 'Host Han', avatar_url: null } }),
            { status: 200 },
          ),
        ),
    })
    const rows = container.querySelectorAll('.waiting-player-list .waiting-player')
    expect(rows[0].textContent).toContain('Host Han (you)')
    expect(rows[1].textContent).not.toContain('(you)')
  })
})

describe('WaitingRoom — Leave Room (CYJ-32)', () => {
  const findLeaveButton = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Leave Room')

  async function clickLeave(container: HTMLElement) {
    const button = findLeaveButton(container)
    expect(button).toBeTruthy()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
  }

  it('non-host: renders the Leave Room action and POSTs leave-room with the room id on click', async () => {
    const { container, fetchMock } = await renderWaitingRoom('/room/r-real-1', { me: GUEST_ME })
    expect(findLeaveButton(container)).toBeTruthy()

    await clickLeave(container)

    const leaveCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/room-authority/leave-room'))
    expect(leaveCall).toBeTruthy()
    const init = leaveCall![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ roomId: 'r-real-1' })
  })

  it('non-host: a 200 leave navigates to /lobby', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1', { me: GUEST_ME, leave: LEAVE_OK })
    await clickLeave(container)
    expect(container.textContent).toContain('LOBBY_MARKER')
  })

  it('host: no Leave Room action is rendered (AC #3)', async () => {
    const { container, fetchMock } = await renderWaitingRoom('/room/r-real-1', { me: HOST_ME })
    expect(findLeaveButton(container)).toBeUndefined()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/room-authority/leave-room'))).toBe(false)
  })

  it('signed-out viewer: no Leave Room action is rendered', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1')
    expect(findLeaveButton(container)).toBeUndefined()
  })

  it('non-host: a 500 leave keeps the player in the room and shows a role=alert error (AC #4)', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1', {
      me: GUEST_ME,
      leave: () => Promise.resolve(new Response('{"error":"room leave failed"}', { status: 500 })),
    })
    await clickLeave(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    // The player stayed: the room is still rendered, the lobby marker is not.
    expect(container.textContent).toContain(PAYLOAD.room.code)
    expect(container.textContent).toContain('Players 2/4')
    expect(container.textContent).not.toContain('LOBBY_MARKER')
  })

  it('non-host: a network rejection keeps the player in the room and shows a role=alert error (AC #4)', async () => {
    const { container } = await renderWaitingRoom('/room/r-real-1', {
      me: GUEST_ME,
      leave: () => Promise.reject(new Error('connection refused')),
    })
    await clickLeave(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    expect(container.textContent).toContain(PAYLOAD.room.code)
    expect(container.textContent).not.toContain('LOBBY_MARKER')
  })
})
