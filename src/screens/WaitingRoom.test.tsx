// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'
import { ROOM, PLAYERS } from '../mock/data'
import { memoryStorage } from '../auth/memoryStorage'

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
    maxPlayers: 4,
  },
  players: [
    { userId: 'u-host', name: 'Host Han', avatarUrl: null, isHost: true },
    { userId: 'u-guest', name: 'Greta Guest', avatarUrl: 'https://x.test/g.png', isHost: false },
  ],
}

const FIXTURE_PLAYER_NAMES = PLAYERS.map((p) => p.name)

async function renderWaitingRoom(
  route: string,
  handlers: {
    room?: (url: string) => Promise<Response>
    me?: () => Promise<Response>
  } = {},
): Promise<{ container: HTMLElement; roomUrls: string[] }> {
  const roomUrls: string[] = []
  const fetchMock = vi.fn((url: string | URL) => {
    const urlString = String(url)
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
        </Routes>
      </MemoryRouter>,
    )
  })
  // Flush the microtask queue so the room fetch's state update lands inside
  // act() (same pattern as Lobby.test.tsx).
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return { container, roomUrls }
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

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
