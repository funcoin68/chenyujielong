// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import Lobby from './Lobby'
import { PROFILE } from '../mock/data'
import { SESSION_TOKEN_KEY } from '../auth/sessionToken'
import { memoryStorage } from '../auth/memoryStorage'

// The functions URL is baked at build time; tests provide one so the
// session fetch is enabled (production sets VITE_FUNCTIONS_URL). CYJ-16
// retired the flag-cyj-7 gate — Lobby always consumes the session.
vi.mock('../config', () => ({ FUNCTIONS_URL: 'https://fn.example', SUPABASE_ANON_KEY: 'anon-key' }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const USER = {
  id: 'u-1',
  email: 'player@example.com',
  display_name: 'Test Player',
  avatar_url: 'https://example.com/p.png',
}

const roots: Root[] = []

async function renderLobby(route: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Lobby />
        {/* CYJ-15: exposes the router's current path+query+hash so tests can
            assert the Lobby stripped the one-shot cyj_session fragment. */}
        <UrlProbe />
      </MemoryRouter>,
    )
  })
  // CYJ-16: Lobby always fetches /auth/me on mount — flush the microtask
  // queue so the session resolution's state update lands inside act().
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return container
}

// Route-aware harness for the CYJ-17 tests: navigation to /room/:roomId is
// asserted via the marker this route renders.
function RoomPage() {
  const { roomId } = useParams()
  return <div data-testid="room-page">ROOM PAGE {roomId}</div>
}

async function renderLobbyWithRoutes(route: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/room/:roomId" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  // CYJ-23: the active-room fetch chains off the session fetch on mount —
  // flush the microtask queue so its state update lands inside act().
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return container
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  )
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

async function openCreateModalAndSubmit(container: HTMLElement): Promise<void> {
  // First click opens the modal (the "+ Create Room" trigger). Once open,
  // the form's submit button is the one inside the modal's <form>.
  await act(async () => {
    findButton(container, 'Create Room').click()
  })
  // The submit button click does not run form-submission steps in this
  // detached jsdom container, so dispatch a bubbling submit event directly
  // (the component calls preventDefault, so no real navigation happens).
  const form = container.querySelector('form.room-settings')
  if (!form) throw new Error('create-room form not found')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function UrlProbe() {
  const location = useLocation()
  return (
    <output data-testid="url-probe">
      {location.pathname + location.search + location.hash}
    </output>
  )
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

describe('Lobby session consumption (CYJ-8 AC #4)', () => {
  it('with a valid session, greets the signed-in user and shows their avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))),
    )
    const container = await renderLobby('/lobby')
    expect(container.textContent).toContain(`Hi, ${USER.display_name}!`)
    // a real name must not be paired with the fabricated fixture streak
    expect(container.textContent).not.toContain('streak')
    const img = container.querySelector<HTMLImageElement>('.lobby-header img')
    expect(img?.getAttribute('src')).toBe(USER.avatar_url)
  })

  // CYJ-16: ungated Lobby always fetches /auth/me once per mount; a 401 (the
  // normal signed-out path) resolves to null and the render is the fixture
  // identity — no session, no error surface.
  it('no session (401), keeps the fixture identity and the network was consulted', async () => {
    const spy = vi.fn(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby')
    expect(container.textContent).toContain(`Hi, ${PROFILE.name}!`)
    expect(container.textContent).toContain(`streak: ${PROFILE.streak}`)
    expect(container.querySelector('.lobby-header img')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // CYJ-15 AC #1: the sign-in success redirect carries the raw session token
  // in a #cyj_session URL fragment; the Lobby must consume it into durable
  // storage (so sessionClient can attach it as x-cyj-session), strip it from
  // the URL before it hits browser history, and still run the session fetch.
  it('consumes cyj_session from the URL fragment, stores it, strips it, and fetches /me with the header', async () => {
    const spy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })))
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby?flags=flag-cyj-7#cyj_session=tok-from-callback')
    // stored durably — exactly what fetchCurrentUser later attaches
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-from-callback')
    // stripped from the router's current location via a replace navigation
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).not.toContain('cyj_session')
    // the session fetch ran, carrying the token header
    expect(spy).toHaveBeenCalled()
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-from-callback')
    expect(container.textContent).toContain(`Hi, ${USER.display_name}!`)
  })

  // CYJ-16: the flag gate is retired — this flagless URL is exactly what the
  // OAuth callback produces (flow.ts echoes flags only when present). The
  // fragment must still be consumed end-to-end: stored, stripped, and the
  // session fetch must run with the token header.
  it('with no flags, still consumes a cyj_session fragment (stores, strips, fetches)', async () => {
    const spy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })))
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby#cyj_session=tok-from-callback')
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-from-callback')
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).not.toContain('cyj_session')
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-from-callback')
    expect(container.textContent).toContain(`Hi, ${USER.display_name}!`)
  })
})

describe('Lobby create room (CYJ-17)', () => {
  // CYJ-17 review (round 1): the flag gate is retired — the real create-room
  // path is unconditional, so these render the flagless /lobby route exactly
  // as the OAuth callback produces it.

  // Dispatches by URL: /auth/me answers the CYJ-7 session fetch, the
  // create-room endpoint answers with the per-test handler.
  function stubFetch(createRoomHandler: (init?: RequestInit) => Promise<Response>) {
    const createCalls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.endsWith('/room-authority/create-room')) {
        createCalls.push({ url: urlString, init })
        return createRoomHandler(init)
      }
      // CYJ-23: the Lobby now also reads the active room for a signed-in
      // user — answer it with the normal empty state so the create-flow
      // assertions stay about create-room.
      if (urlString.endsWith('/room-authority/active-room')) {
        return Promise.resolve(new Response('{"room":null}', { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, createCalls }
  }

  it('200: POSTs to room-authority/create-room and navigates to /room/:roomId', async () => {
    const { createCalls } = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ roomId: 'r-new-1', code: 'AB23CD', alreadyExisted: false }), {
          status: 200,
        }),
      ),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    await openCreateModalAndSubmit(container)

    expect(createCalls).toHaveLength(1)
    const body = JSON.parse(String(createCalls[0].init?.body))
    expect(body).toMatchObject({ rule: 'strict', turnSeconds: 30, maxPlayers: 4 })
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe('ROOM PAGE r-new-1')
    // navigation closed the modal
    expect(container.querySelector('form.room-settings')).toBeNull()
  })

  it('existing active room 200: navigates to the returned (existing) room id', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ roomId: 'r-existing', code: 'K7M2QP', alreadyExisted: true }), {
          status: 200,
        }),
      ),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    await openCreateModalAndSubmit(container)
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe(
      'ROOM PAGE r-existing',
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('401: shows a visible sign-in error, does not navigate, sends exactly one create request', async () => {
    const { createCalls } = stubFetch(() =>
      Promise.resolve(new Response('{"error":"no session"}', { status: 401 })),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    await openCreateModalAndSubmit(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('sign in')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    // the only writer is the Edge Function — one attempt, no retry, no row
    expect(createCalls).toHaveLength(1)
  })

  it('network rejection: shows a visible error and does not navigate', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))
    const container = await renderLobbyWithRoutes('/lobby')
    await openCreateModalAndSubmit(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    expect(alert?.textContent).not.toContain('sign in')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
  })
})

describe('Lobby active room (CYJ-23)', () => {
  const ACTIVE_ROOM = { roomId: 'r-active', code: 'Q4W7EK', name: 'Chain gang', status: 'waiting' }

  // Dispatches by URL like the CYJ-17 block: /auth/me answers the session
  // fetch, /room-authority/active-room and close-room answer per-test.
  function stubFetch(handlers: {
    me?: () => Promise<Response>
    activeRoom?: () => Promise<Response>
    closeRoom?: (init?: RequestInit) => Promise<Response>
  }) {
    const closeCalls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.endsWith('/room-authority/close-room')) {
        closeCalls.push({ url: urlString, init })
        return (handlers.closeRoom ?? (() => Promise.resolve(new Response('{}', { status: 200 }))))(init)
      }
      if (urlString.endsWith('/room-authority/active-room')) {
        return (handlers.activeRoom ?? (() =>
          Promise.resolve(new Response(JSON.stringify({ room: ACTIVE_ROOM }), { status: 200 }))))()
      }
      return (handlers.me ?? (() =>
        Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))))()
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, closeCalls }
  }

  async function confirmClose(container: HTMLElement): Promise<void> {
    await act(async () => {
      findButton(container, 'Close room').click()
    })
    const dialog = container.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('close-room dialog not found')
    await act(async () => {
      findButton(dialog as HTMLElement, 'Close room').click()
    })
  }

  it('shows the active room section with the code and navigates on Enter', async () => {
    stubFetch({})
    const container = await renderLobbyWithRoutes('/lobby')
    const section = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain(ACTIVE_ROOM.code)
    expect(section?.textContent).not.toContain('No active room')

    await act(async () => {
      findButton(container, 'Enter').click()
    })
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe(
      `ROOM PAGE ${ACTIVE_ROOM.roomId}`,
    )
  })

  it('shows the empty state when the signed-in user has no active room', async () => {
    stubFetch({ activeRoom: () => Promise.resolve(new Response('{"room":null}', { status: 200 })) })
    const container = await renderLobbyWithRoutes('/lobby')
    const section = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(section?.textContent).toContain('No active room')
  })

  it('signed out: the section is absent and the create-room flow is unaffected', async () => {
    const me = () => Promise.resolve(new Response('{"error":"no session"}', { status: 401 }))
    stubFetch({ me })
    const container = await renderLobbyWithRoutes('/lobby')
    expect(container.querySelector('[aria-labelledby="lobby-active-heading"]')).toBeNull()

    // create-room still works end to end from the signed-out view
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL) => {
        const urlString = String(url)
        if (urlString.endsWith('/room-authority/create-room')) {
          return Promise.resolve(
            new Response(JSON.stringify({ roomId: 'r-new-1', code: 'AB23CD', alreadyExisted: false }), {
              status: 200,
            }),
          )
        }
        return me()
      }),
    )
    await openCreateModalAndSubmit(container)
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe('ROOM PAGE r-new-1')
  })

  it('close confirm: POSTs the roomId and the section falls back to the empty state', async () => {
    const { closeCalls } = stubFetch({
      closeRoom: () =>
        Promise.resolve(new Response(JSON.stringify({ roomId: 'r-active', status: 'closed' }), { status: 200 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    await confirmClose(container)

    expect(closeCalls).toHaveLength(1)
    expect(JSON.parse(String(closeCalls[0].init?.body))).toEqual({ roomId: 'r-active' })
    const section = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(section?.textContent).toContain('No active room')
    expect(section?.textContent).not.toContain(ACTIVE_ROOM.code)
  })

  it('close forbidden: shows an alert in the modal and the room row is still rendered', async () => {
    stubFetch({
      closeRoom: () =>
        Promise.resolve(new Response('{"error":"not the room owner"}', { status: 403 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    await confirmClose(container)

    const section = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(section?.textContent).toContain(ACTIVE_ROOM.code)
    // The error renders only inside the confirm modal — never duplicated in
    // the section behind it.
    expect(section?.querySelector('[role="alert"]')).toBeNull()
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })

  it('active-room read failure: surfaces an alert instead of a false empty state', async () => {
    stubFetch({
      activeRoom: () => Promise.resolve(new Response('{"error":"lookup failed"}', { status: 500 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    const section = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(section?.textContent).not.toContain('No active room')
    expect(section?.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })

  // CYJ-24: the friends-rooms section and the active-room section swapped DOM
  // positions; content is unchanged (the CYJ-23 tests above pass unmodified).
  it('renders the friends-rooms section before the active-room section', async () => {
    stubFetch({})
    const container = await renderLobbyWithRoutes('/lobby')
    const rooms = container.querySelector('[aria-labelledby="lobby-rooms-heading"]')
    const active = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(rooms).not.toBeNull()
    expect(active).not.toBeNull()
    expect(rooms!.compareDocumentPosition(active!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(active!.compareDocumentPosition(rooms!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
