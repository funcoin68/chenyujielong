// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Landing from '../screens/Landing'
import Lobby from '../screens/Lobby'
import WaitingRoom from '../screens/WaitingRoom'
import { invalidateSessionCache } from './sessionClient'
import { memoryStorage } from './memoryStorage'
import { PROFILE } from '../mock/data'

// The functions URL + anon key are baked at build time; tests provide both so
// the session lookup is enabled (same hoisted-getter pattern as
// Landing.test.tsx).
const configState = vi.hoisted(() => ({
  functionsUrl: 'https://fn.example',
  anonKey: 'anon-key-123',
}))
vi.mock('../config', () => ({
  get FUNCTIONS_URL() {
    return configState.functionsUrl
  },
  get SUPABASE_ANON_KEY() {
    return configState.anonKey
  },
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

const USER = {
  id: 'u-1',
  email: 'player@example.com',
  display_name: 'Test Player',
  avatar_url: null,
}

// WaitingRoom's room-authority payload — includes a player row for the
// session user so the "(you)" marker renders (identity cross-check, AC #2).
const ROOM_PAYLOAD = {
  room: {
    roomId: 'r-real-1',
    code: 'ZZ99ZZ',
    name: 'Nav Room',
    status: 'waiting',
    ownerId: 'u-1',
    maxPlayers: 4,
    // CYJ-28: the settings columns ride the same GET response (required in
    // the client contract from here on).
    rule: 'strict',
    turnSeconds: 30,
    winCondition: 'rounds',
    dictionary: 'common',
  },
  players: [
    { userId: 'u-1', name: 'Test Player', avatarUrl: null, isHost: true },
    { userId: 'u-guest', name: 'Greta Guest', avatarUrl: null, isHost: false },
  ],
}

function stubFetch(me: { user: Record<string, unknown> | null; status: number }) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        new Response(
          JSON.stringify(me.user ? { user: me.user } : { error: 'no session' }),
          { status: me.status },
        ),
      )
    }
    if (url.endsWith('/room-authority/active-room')) {
      return Promise.resolve(new Response(JSON.stringify({ room: null }), { status: 200 }))
    }
    // CYJ-34: the Lobby's joined-rooms read answers with the normal empty
    // state so these assertions stay about the session cache.
    if (url.endsWith('/room-authority/joined-rooms')) {
      return Promise.resolve(new Response(JSON.stringify({ rooms: [] }), { status: 200 }))
    }
    if (url.includes('/room-authority/room/')) {
      return Promise.resolve(new Response(JSON.stringify(ROOM_PAYLOAD), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 }))
  })
}

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function renderAt(route: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/room/:roomId" element={<WaitingRoom />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flushMicrotasks()
  return container
}

async function clickButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  )
  if (!button) throw new Error(`button "${text}" not found`)
  await act(async () => {
    button.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function meFetchCalls(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  invalidateSessionCache()
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
  configState.functionsUrl = 'https://fn.example'
})

describe('session navigation — cached /me across screens (CYJ-26)', () => {
  it('AC #1/#2: Landing → Lobby → Enter Room fires exactly ONE /me fetch and every screen shows the same identity', async () => {
    const spy = stubFetch({ user: USER, status: 200 })
    vi.stubGlobal('fetch', spy)

    const landing = await renderAt('/')
    expect(landing.textContent).toContain('Welcome back Test Player')

    await clickButton(landing, 'Go to Lobby')
    expect(landing.textContent).toContain('Hi, Test Player!')

    await clickButton(landing, 'Quick Play')
    // WaitingRoom renders the room-authority payload…
    expect(landing.textContent).toContain(ROOM_PAYLOAD.room.code)
    // …and marks the session user as "(you)" — the same identity Landing and
    // Lobby rendered, from the single cached /me lookup.
    expect(landing.textContent).toContain('Test Player (you)')

    expect(meFetchCalls(spy)).toHaveLength(1)
  })

  it('401 variant: sequential signed-out navigations stay signed out and still cost only one /me fetch', async () => {
    const spy = stubFetch({ user: null, status: 401 })
    vi.stubGlobal('fetch', spy)

    const landing = await renderAt('/')
    expect(landing.textContent).toContain('Sign in with Google')
    expect(landing.textContent).not.toContain('Welcome back')

    // The next navigation (fresh mount, same as arriving from Landing when
    // signed out): the anonymous 401 is the cached definitive signed-out
    // state, so Lobby renders without refetching.
    const lobby = await renderAt('/lobby')
    expect(lobby.textContent).toContain(`Hi, ${PROFILE.name}!`)
    expect(lobby.textContent).not.toContain(`Hi, ${USER.display_name}!`)

    expect(meFetchCalls(spy)).toHaveLength(1)
  })
})
