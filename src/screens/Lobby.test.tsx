// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import Lobby from './Lobby'
import { PROFILE } from '../mock/data'
import { SESSION_TOKEN_KEY } from '../auth/sessionToken'
import { invalidateSessionCache } from '../auth/sessionClient'
import { memoryStorage } from '../auth/memoryStorage'

/** An entry MemoryRouter accepts in initialEntries — derived from its own
 *  props so we don't depend on a deep re-exported type name. */
type RouterInitialEntry = NonNullable<ComponentProps<typeof MemoryRouter>['initialEntries']>[number]

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

async function renderLobby(route: string | RouterInitialEntry): Promise<HTMLElement> {
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
        {/* CYJ-31: the join-by-code tests assert NO navigation via the probe. */}
        <UrlProbe />
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // CYJ-26: fetchCurrentUser caches per token — reset so a previous test's
  // cache can't suppress this test's mount-time fetch.
  invalidateSessionCache()
})

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

  // CYJ-28 review (round 2): a redirect-with-notice (router location state)
  // landing on a URL that ALSO carries the #cyj_session fragment must render
  // the notice after the strip effect's replace navigation — the effect
  // preserves location.state, so the hand-off survives instead of being
  // silently swallowed (rule 12).
  it('survives the cyj_session fragment strip: a redirect-with-notice still renders', async () => {
    // 200 (signed in), not 401: a 401 is the definitive signed-out state and
    // clears the just-stored token (sessionClient), which would fight this
    // test's storage assertion.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))),
    )
    const container = await renderLobby({
      pathname: '/lobby',
      hash: '#cyj_session=tok-from-callback',
      state: { notice: 'Room not found.' },
    })
    expect(container.querySelector('.lobby-notice')?.textContent).toContain('Room not found.')
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).not.toContain('cyj_session')
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-from-callback')
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
      // CYJ-34: same for the joined-rooms read.
      if (urlString.endsWith('/room-authority/joined-rooms')) {
        return Promise.resolve(new Response('{"rooms":[]}', { status: 200 }))
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

describe('Lobby create-room name default (CYJ-27)', () => {
  // Dispatches by URL like the CYJ-17 block, but with a per-test display_name.
  function stubFetch(displayName: string | null) {
    const createCalls: { url: string; init?: RequestInit }[] = []
    const user = displayName === null ? null : { ...USER, display_name: displayName }
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.endsWith('/room-authority/create-room')) {
        createCalls.push({ url: urlString, init })
        return Promise.resolve(
          new Response(JSON.stringify({ roomId: 'r-new-1', code: 'AB23CD', alreadyExisted: false }), {
            status: 200,
          }),
        )
      }
      if (urlString.endsWith('/room-authority/active-room')) {
        return Promise.resolve(new Response('{"room":null}', { status: 200 }))
      }
      if (urlString.endsWith('/room-authority/joined-rooms')) {
        return Promise.resolve(new Response('{"rooms":[]}', { status: 200 }))
      }
      return Promise.resolve(
        new Response(user ? JSON.stringify({ user }) : '{"error":"no session"}', {
          status: user ? 200 : 401,
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return { createCalls }
  }

  async function openCreateModal(container: HTMLElement): Promise<HTMLInputElement> {
    await act(async () => {
      findButton(container, 'Create Room').click()
    })
    const input = container.querySelector<HTMLInputElement>('input.room-settings-name')
    if (!input) throw new Error('room-name input not found')
    return input
  }

  // AC #1: multi-token display_name → first token + "'s room".
  it('pre-fills "Wei\'s room" for display_name "Wei Chen"', async () => {
    stubFetch('Wei Chen')
    const container = await renderLobbyWithRoutes('/lobby')
    const input = await openCreateModal(container)
    expect(input.value).toBe("Wei's room")
  })

  // AC #2: a single token is its own first token.
  it('pre-fills "小明\'s room" for single-token display_name "小明"', async () => {
    stubFetch('小明')
    const container = await renderLobbyWithRoutes('/lobby')
    const input = await openCreateModal(container)
    expect(input.value).toBe("小明's room")
  })

  // AC #3 (revised): empty/missing display_name → empty field, placeholder
  // shows, and no other user's name leaks into the form.
  it('empty display_name: renders empty with the "Room name" placeholder', async () => {
    stubFetch('')
    const container = await renderLobbyWithRoutes('/lobby')
    const input = await openCreateModal(container)
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBe('Room name')
    expect(container.querySelector('form.room-settings')?.textContent).not.toContain('Wei')
  })

  // AC #3/#4: signed-out → empty field, no hardcoded "Wei's room" anywhere.
  it('signed out: renders empty and contains no "Wei\'s room" anywhere', async () => {
    stubFetch(null)
    const container = await renderLobbyWithRoutes('/lobby')
    const input = await openCreateModal(container)
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBe('Room name')
    expect(container.textContent).not.toContain("Wei's room")
  })

  // AC #5: the derived default passes through to the create-room call verbatim.
  it('submits the pre-filled name unchanged to create-room', async () => {
    const { createCalls } = stubFetch('Wei Chen')
    const container = await renderLobbyWithRoutes('/lobby')
    await openCreateModalAndSubmit(container)
    expect(createCalls).toHaveLength(1)
    const body = JSON.parse(String(createCalls[0].init?.body))
    expect(body.name).toBe("Wei's room")
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
      // CYJ-34: the joined-rooms read answers with the normal empty state so
      // these assertions stay about the active-room section.
      if (urlString.endsWith('/room-authority/joined-rooms')) {
        return Promise.resolve(new Response('{"rooms":[]}', { status: 200 }))
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

describe('Lobby join by code (CYJ-31)', () => {
  // Dispatches by URL like the CYJ-17 block: /auth/me and active-room answer
  // the mount-time fetches; room-by-code answers with the per-test handler.
  // CYJ-33: the join-room mutation answers with a per-test handler too
  // (default 200) and its calls are recorded — AC #1 asserts EXACTLY ONE
  // mutation per successful join, and the failure tests assert none.
  function stubFetch(
    lookupHandler: (url: string) => Promise<Response>,
    joinHandler: (init?: RequestInit) => Promise<Response> = () =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-joined' }), { status: 200 })),
  ) {
    const lookupCalls: string[] = []
    const joinCalls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.includes('/room-authority/room-by-code/')) {
        lookupCalls.push(urlString)
        return lookupHandler(urlString)
      }
      if (urlString.endsWith('/room-authority/join-room')) {
        joinCalls.push({ url: urlString, init })
        return joinHandler(init)
      }
      if (urlString.endsWith('/room-authority/active-room')) {
        return Promise.resolve(new Response('{"room":null}', { status: 200 }))
      }
      if (urlString.endsWith('/room-authority/joined-rooms')) {
        return Promise.resolve(new Response('{"rooms":[]}', { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return { lookupCalls, joinCalls }
  }

  // CodeInput auto-submits on the 6th character; a paste fills all six boxes
  // in one shot. jsdom has no ClipboardEvent payload, so the paste event
  // carries a stub clipboardData (the component only reads getData('text')).
  async function pasteCode(container: HTMLElement, code: string): Promise<HTMLElement> {
    await act(async () => {
      findButton(container, 'Join Code').click()
    })
    const dialog = container.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('join dialog not found')
    const firstBox = dialog.querySelector('input.code-input-box')
    if (!firstBox) throw new Error('code input not found')
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: () => code },
    })
    await act(async () => {
      firstBox.dispatchEvent(pasteEvent)
      // flush submitJoin's lookup fetch and its state update
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    return dialog as HTMLElement
  }

  // AC #1 (CYJ-33): a valid code triggers the room-authority lookup keyed by
  // that code, then EXACTLY ONE join-room mutation inserting the joiner into
  // room_players for the looked-up room, then navigation to /room/:roomId.
  it('valid code: looks up the room, issues exactly one join mutation, and navigates', async () => {
    const { lookupCalls, joinCalls } = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ roomId: 'r-joined', code: 'AB23CD' }), { status: 200 }),
      ),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    await pasteCode(container, 'AB23CD')

    expect(lookupCalls).toHaveLength(1)
    expect(lookupCalls[0]).toContain('/room-authority/room-by-code/AB23CD')
    expect(joinCalls).toHaveLength(1)
    expect(JSON.parse(String(joinCalls[0].init?.body))).toEqual({ roomId: 'r-joined' })
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe(
      'ROOM PAGE r-joined',
    )
  })

  // AC #2 (CYJ-31): an unknown code shows the inline error, the user stays on
  // the form with the typed code preserved, and no navigation occurs. CYJ-33:
  // no join mutation is ever issued for an unknown code (AC #5).
  it('unknown code: inline error, input preserved, no navigation, no join mutation', async () => {
    const { lookupCalls, joinCalls } = stubFetch(() =>
      Promise.resolve(new Response('{"error":"no room found for that code"}', { status: 404 })),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    const dialog = await pasteCode(container, 'ZZZZZZ')

    expect(lookupCalls).toHaveLength(1)
    expect(joinCalls).toHaveLength(0)
    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('No room found for that code.')
    // no navigation: no room page, the URL probe still reports /lobby
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).toBe('/lobby')
    // the modal stayed open, so CodeInput kept its state — the six boxes
    // still hold the typed characters
    const boxes = Array.from(dialog.querySelectorAll<HTMLInputElement>('input.code-input-box'))
    expect(boxes).toHaveLength(6)
    expect(boxes.map((b) => b.value).join('')).toBe('ZZZZZZ')
  })

  // AC #5 (CYJ-33): the room closed between lookup and join (expired code) —
  // the join 404 surfaces a client-visible error and no navigation occurs.
  it('join not-found (room closed mid-flow): inline expired message, no navigation', async () => {
    const { joinCalls } = stubFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ roomId: 'r-closed', code: 'AB23CD' }), { status: 200 }),
        ),
      () => Promise.resolve(new Response('{"error":"room has closed"}', { status: 404 })),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    const dialog = await pasteCode(container, 'AB23CD')

    expect(joinCalls).toHaveLength(1)
    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('That room is no longer available.')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).toBe('/lobby')
  })

  // Joining requires an account (the insert needs a user id) — a 401 from
  // join-room shows the sign-in message inline, no navigation.
  it('join 401: shows the sign-in message inline and does not navigate', async () => {
    stubFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ roomId: 'r-joined', code: 'AB23CD' }), { status: 200 }),
        ),
      () => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    const dialog = await pasteCode(container, 'AB23CD')

    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Please sign in to join a room.')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).toBe('/lobby')
  })

  // A join transport failure surfaces its message inline (rule 12) — no
  // navigation, no silent swallow.
  it('join failure: shows the server message inline and does not navigate', async () => {
    stubFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ roomId: 'r-joined', code: 'AB23CD' }), { status: 200 }),
        ),
      () => Promise.resolve(new Response('{"error":"room join failed"}', { status: 500 })),
    )
    const container = await renderLobbyWithRoutes('/lobby')
    const dialog = await pasteCode(container, 'AB23CD')

    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('room join failed')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).toBe('/lobby')
  })

  // A server/transport failure surfaces its message inline, same discipline
  // as the create modal — no navigation, no silent swallow (rule 12).
  it('lookup failure: shows the server message inline and does not navigate', async () => {
    stubFetch(() => Promise.resolve(new Response('{"error":"room lookup failed"}', { status: 500 })))
    const container = await renderLobbyWithRoutes('/lobby')
    const dialog = await pasteCode(container, 'AB23CD')

    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('room lookup failed')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="url-probe"]')?.textContent).toBe('/lobby')
  })
})

describe('Lobby joined rooms (CYJ-34)', () => {
  const JOINED = [
    { roomId: 'r-joined-1', code: 'AB23CD', name: 'Chain gang', hostName: 'Host Han' },
    { roomId: 'r-joined-2', code: 'K7M2QP', name: null, hostName: 'Greta Guest' },
  ]

  // Dispatches by URL like the CYJ-23 block: /auth/me answers the session
  // fetch, active-room and joined-rooms answer per-test. joinedCalls records
  // the joined-rooms requests so the signed-out test can assert the endpoint
  // is never hit without a session.
  function stubFetch(
    handlers: {
      me?: () => Promise<Response>
      activeRoom?: () => Promise<Response>
      joinedRooms?: () => Promise<Response>
    } = {},
  ) {
    const joinedCalls: string[] = []
    const fetchMock = vi.fn((url: string | URL) => {
      const urlString = String(url)
      if (urlString.endsWith('/room-authority/joined-rooms')) {
        joinedCalls.push(urlString)
        return (handlers.joinedRooms ?? (() =>
          Promise.resolve(new Response(JSON.stringify({ rooms: JOINED }), { status: 200 }))))()
      }
      if (urlString.endsWith('/room-authority/active-room')) {
        return (handlers.activeRoom ?? (() =>
          Promise.resolve(new Response('{"room":null}', { status: 200 }))))()
      }
      return (handlers.me ?? (() =>
        Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))))()
    })
    vi.stubGlobal('fetch', fetchMock)
    return { joinedCalls }
  }

  function joinedSection(container: HTMLElement): HTMLElement {
    const section = container.querySelector('[aria-labelledby="lobby-joined-heading"]')
    if (!section) throw new Error('joined-rooms section not found')
    return section as HTMLElement
  }

  // AC #3: the section lists every room the endpoint returns, each entry
  // showing the room name and the host name — in a section visibly separate
  // from the hosted-rooms ("Your active room") section.
  it('lists every joined room with its name and host name in its own section', async () => {
    stubFetch()
    const container = await renderLobbyWithRoutes('/lobby')
    const section = joinedSection(container)
    expect(section.textContent).toContain('Chain gang')
    expect(section.textContent).toContain('Host Han')
    expect(section.textContent).toContain('Greta Guest')
    // visibly separate: a distinct section from the hosted-rooms one
    const active = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(active).not.toBeNull()
    expect(section).not.toBe(active)
  })

  // AC #4: each entry navigates to /room/:roomId for that room.
  it('navigates to /room/:roomId when a joined entry is opened', async () => {
    stubFetch()
    const container = await renderLobbyWithRoutes('/lobby')
    const enterButtons = Array.from(joinedSection(container).querySelectorAll('button')).filter(
      (b) => b.textContent === 'Enter',
    )
    expect(enterButtons).toHaveLength(2)
    await act(async () => {
      enterButtons[0].click()
    })
    expect(container.querySelector('[data-testid="room-page"]')?.textContent).toBe(
      'ROOM PAGE r-joined-1',
    )
  })

  // AC #6: no non-hosted rooms → an explicit empty state, never a spinner or
  // a blank area (and never an error).
  it('renders the empty state when the user belongs to no non-hosted rooms', async () => {
    stubFetch({
      joinedRooms: () => Promise.resolve(new Response('{"rooms":[]}', { status: 200 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    const section = joinedSection(container)
    expect(section.textContent).toContain("You haven't joined any rooms yet")
    expect(section.querySelector('[role="alert"]')).toBeNull()
  })

  // Rule 12: a failed read is a visible alert, never a false empty state.
  it('endpoint failure: surfaces an alert instead of a false empty state', async () => {
    stubFetch({
      joinedRooms: () =>
        Promise.resolve(new Response('{"error":"joined rooms lookup failed"}', { status: 500 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    const section = joinedSection(container)
    expect(section.textContent).not.toContain("haven't joined")
    expect(section.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })

  // AC #5: a user who hosts one room AND joined another sees only the joined
  // room in the new section. The endpoint performs the exclusion (covered in
  // joinedRooms.test.ts) — the stub returns what the endpoint returns.
  it('a room the user hosts never appears in the joined section (host + joined elsewhere)', async () => {
    const HOSTED = { roomId: 'r-hosted', code: 'ZZ99ZZ', name: 'My own room', status: 'waiting' }
    stubFetch({
      activeRoom: () =>
        Promise.resolve(new Response(JSON.stringify({ room: HOSTED }), { status: 200 })),
      joinedRooms: () =>
        Promise.resolve(new Response(JSON.stringify({ rooms: [JOINED[0]] }), { status: 200 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    const active = container.querySelector('[aria-labelledby="lobby-active-heading"]')
    expect(active?.textContent).toContain('ZZ99ZZ')
    const section = joinedSection(container)
    expect(section.textContent).toContain('Chain gang')
    expect(section.textContent).not.toContain('ZZ99ZZ')
    expect(section.textContent).not.toContain('My own room')
  })

  // The endpoint is session-gated: anonymous visitors never fire the fetch
  // and never see the section.
  it('signed out: the section is absent and the endpoint is never called', async () => {
    const { joinedCalls } = stubFetch({
      me: () => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })),
    })
    const container = await renderLobbyWithRoutes('/lobby')
    expect(container.querySelector('[aria-labelledby="lobby-joined-heading"]')).toBeNull()
    expect(joinedCalls).toHaveLength(0)
  })
})
