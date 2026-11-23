// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import Lobby from './Lobby'
import { PROFILE } from '../mock/data'

// The functions URL is baked at build time; tests provide one so the
// flag-cyj-7 session fetch is enabled (production sets VITE_FUNCTIONS_URL).
vi.mock('../config', () => ({ FUNCTIONS_URL: 'https://fn.example' }))

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
      </MemoryRouter>,
    )
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

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount()
  vi.unstubAllGlobals()
})

describe('Lobby session consumption (CYJ-8 AC #4)', () => {
  // '/lobby?flags=flag-cyj-7' is exactly the URL the OAuth callback now
  // redirects to — flow.ts embeds the flags in the state at /auth/google/
  // start and echoes them back on success (asserted in flow.test.ts).
  it('with flag-cyj-7 and a valid session, greets the signed-in user and shows their avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))),
    )
    const container = await renderLobby('/lobby?flags=flag-cyj-7')
    expect(container.textContent).toContain(`Hi, ${USER.display_name}!`)
    // a real name must not be paired with the fabricated fixture streak
    expect(container.textContent).not.toContain('streak')
    const img = container.querySelector<HTMLImageElement>('.lobby-header img')
    expect(img?.getAttribute('src')).toBe(USER.avatar_url)
  })

  it('without the flag, renders the fixture identity and never calls the network', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby')
    expect(container.textContent).toContain(`Hi, ${PROFILE.name}!`)
    expect(container.textContent).toContain(`streak: ${PROFILE.streak}`)
    expect(container.querySelector('.lobby-header img')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('with the flag but no session (401), keeps the fixture identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 }))),
    )
    const container = await renderLobby('/lobby?flags=flag-cyj-7')
    expect(container.textContent).toContain(`Hi, ${PROFILE.name}!`)
  })
})

describe('Lobby create room (CYJ-17)', () => {
  const FLAGS = '/lobby?flags=flag-cyj-17'

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
      return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, createCalls }
  }

  it('flag on + 200: POSTs to room-authority/create-room and navigates to /room/:roomId', async () => {
    const { createCalls } = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ roomId: 'r-new-1', code: 'AB23CD', alreadyExisted: false }), {
          status: 200,
        }),
      ),
    )
    const container = await renderLobbyWithRoutes(FLAGS)
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
    const container = await renderLobbyWithRoutes(FLAGS)
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
    const container = await renderLobbyWithRoutes(FLAGS)
    await openCreateModalAndSubmit(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('sign in')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
    // the only writer is the Edge Function — one attempt, no retry, no row
    expect(createCalls).toHaveLength(1)
  })

  it('network rejection: shows a visible error and does not navigate', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))
    const container = await renderLobbyWithRoutes(FLAGS)
    await openCreateModalAndSubmit(container)

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBeTruthy()
    expect(alert?.textContent).not.toContain('sign in')
    expect(container.querySelector('[data-testid="room-page"]')).toBeNull()
  })
})
