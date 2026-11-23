// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Landing from './Landing'
import { invalidateSessionCache } from '../auth/sessionClient'
import { memoryStorage } from '../auth/memoryStorage'

// The functions URL + anon key are baked at build time; tests provide both so
// the sign-in path is enabled (mirrors Lobby.test.tsx). CYJ-16 retired the
// flag-cyj-7 gate — sign-in is live for all users whenever auth is configured.
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

// jsdom's window.location.assign is non-configurable, so the component
// navigates through navigateTo() — intercepted here. AC #4's behavior
// assertion is WHERE the browser would navigate, not the DOM API used.
const navCalls = vi.hoisted(() => ({ urls: [] as string[], storedStates: [] as (string | null)[] }))
vi.mock('../auth/authStart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/authStart')>()),
  navigateTo: (url: string) => {
    // Capture the durable-storage nonce at navigation time so tests can
    // assert it was persisted BEFORE the browser left for Google (CYJ-14).
    navCalls.urls.push(url)
    navCalls.storedStates.push(localStorage.getItem('cyj_oauth_state'))
  },
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// The vitest jsdom env here exposes no localStorage (opaque-origin window),
// so tests stub a deterministic in-memory Storage (shared helper).
const roots: Root[] = []

// CYJ-19: Landing mounts a session check (fetchCurrentUser → GET /auth/me),
// so every mount fires a fetch. Tests that care about fetch responses stub
// it themselves BEFORE renderLanding — the .mock check below leaves those
// untouched. Everything else gets a URL-routed default: /auth/me → 401
// "no session" (the signed-out state), any other URL → 401 unauthorized
// (preserves the pre-CYJ-19 behavior of the signed-out-path tests).
function defaultFetchStub() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'no session' }), { status: 401 }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
  })
}

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function renderLanding(route: string): Promise<HTMLElement> {
  vi.stubGlobal('localStorage', memoryStorage())
  // CYJ-26: fetchCurrentUser caches per token — reset so a previous test's
  // cache can't suppress this test's mount-time fetch.
  invalidateSessionCache()
  if (!(globalThis.fetch as unknown as { mock?: unknown }).mock) {
    vi.stubGlobal('fetch', defaultFetchStub())
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lobby" element={<p>lobby-destination</p>} />
        </Routes>
      </MemoryRouter>,
    )
  })
  return container
}

async function clickSignIn(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>('.landing-google')
  expect(button).not.toBeNull()
  await act(async () => {
    button!.click()
    // The async handler awaits fetch + res.json(); flush the microtask queue
    // so its state updates land inside this act().
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  navCalls.urls.length = 0
  navCalls.storedStates.length = 0
  vi.unstubAllGlobals()
})

describe('Landing auth_error banner (CYJ-14 AC #3)', () => {
  it('?auth_error=state_mismatch renders the exact AC message', async () => {
    const container = await renderLanding('/?auth_error=state_mismatch')

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Sign-in failed (state_mismatch). Please try again.',
    )
    // no sign-in attempt was made — the banner comes from the bounce alone
    expect(navCalls.urls).toEqual([])
  })
})

describe('Landing Google sign-in (CYJ-14 AC #1)', () => {
  // CYJ-16 AC #1: with no query params at all, the Google sign-in control
  // renders and is the real OAuth control (not the mock /lobby navigate).
  it('renders the Google sign-in button on / with no query params', async () => {
    const container = await renderLanding('/')

    expect(container.querySelector('.landing-google')?.textContent).toContain('Sign in with Google')
  })

  it('persists the OAuth state nonce to durable storage BEFORE navigating to Google', async () => {
    const googleUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fauth%2Fcallback&state=abc'
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
      ),
    )
    const container = await renderLanding('/')

    await clickSignIn(container)

    // AC #1: the nonce is in localStorage at the moment navigateTo fires,
    // and it survives after — durable across the Google round-trip.
    expect(navCalls.storedStates).toEqual(['abc'])
    expect(localStorage.getItem('cyj_oauth_state')).toBe('abc')
    expect(navCalls.urls).toEqual([googleUrl])
  })

  // Review round 1: localStorage.setItem can throw (storage-disabled contexts,
  // Safari private mode) — sign-in must degrade to the cookie-only flow and
  // still navigate to Google, not show the failure banner.
  it('storage failure still navigates to Google with no error banner', async () => {
    const googleUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fauth%2Fcallback&state=abc'
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
      ),
    )
    const container = await renderLanding('/')
    // Replace the working stub with one whose setItem throws (QuotaExceeded).
    const failing = memoryStorage()
    failing.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', failing)

    await clickSignIn(container)

    expect(navCalls.urls).toEqual([googleUrl])
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})

// CYJ-16 AC #3: stale preview/bookmarked URLs carrying the removed flag must
// still render cleanly — flag parsing never throws on unknown flags.
describe('Landing with removed flag-cyj-7 (CYJ-16 AC #3)', () => {
  it('?flags=flag-cyj-7 renders without errors and sign-in still initiates OAuth', async () => {
    const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc'
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
      ),
    )
    const container = await renderLanding('/?flags=flag-cyj-7')

    await clickSignIn(container)

    expect(navCalls.urls).toEqual([googleUrl])
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('Landing session check (CYJ-19)', () => {
  const sessionUser = {
    id: 'u1',
    email: 'janedoe@example.com',
    display_name: 'Jane Doe',
    avatar_url: null,
  }

  function sessionFetchStub(user: Record<string, unknown> | null, status = 200) {
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(user ? { user } : { error: 'no session' }), { status }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      )
    })
  }

  // AC #1: valid session → welcome text from the session response, a "Go to
  // Lobby" button, and the Google sign-in control gone.
  it('/auth/me 200 with user renders "Welcome back <display_name>", Go to Lobby, and no sign-in button', async () => {
    vi.stubGlobal('fetch', sessionFetchStub(sessionUser))
    const container = await renderLanding('/')
    await flushMicrotasks()

    expect(container.textContent).toContain('Welcome back Jane Doe')
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.some((b) => b.textContent?.trim() === 'Go to Lobby')).toBe(true)
    expect(container.querySelector('.landing-google')).toBeNull()
  })

  // AC #2: Go to Lobby navigates client-side — the router renders the lobby
  // route in place, and navigateTo (full-page navigation) never fires.
  it('clicking "Go to Lobby" router-navigates to /lobby with no full page reload', async () => {
    vi.stubGlobal('fetch', sessionFetchStub(sessionUser))
    const container = await renderLanding('/')
    await flushMicrotasks()

    const goToLobby = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Go to Lobby',
    )
    expect(goToLobby).toBeDefined()
    await act(async () => {
      goToLobby!.click()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(container.textContent).toContain('lobby-destination')
    expect(navCalls.urls).toEqual([])
  })

  // AC #3: no session → exactly the CYJ-16 signed-out rendering.
  it('/auth/me 401 renders the Google sign-in button with no welcome text or lobby button', async () => {
    vi.stubGlobal('fetch', sessionFetchStub(null, 401))
    const container = await renderLanding('/')
    await flushMicrotasks()

    expect(container.querySelector('.landing-google')?.textContent).toContain('Sign in with Google')
    expect(container.textContent).not.toContain('Welcome back')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Go to Lobby',
      ),
    ).toBe(false)
  })

  // AC #4: in-flight session check → loading indicator only, neither the
  // sign-in control nor the welcome/lobby UI.
  it('/auth/me in-flight renders a role="status" indicator and neither auth control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/me')) return new Promise<Response>(() => {})
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
        )
      }),
    )
    const container = await renderLanding('/')
    await flushMicrotasks()

    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector('.landing-google')).toBeNull()
    expect(container.textContent).not.toContain('Welcome back')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'Go to Lobby',
      ),
    ).toBe(false)
  })
})

describe('Landing Google sign-in (CYJ-10 AC #4)', () => {
  it('clicking sign-in calls the start endpoint programmatically and navigates to the redirect it returns', async () => {
    const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc'
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const container = await renderLanding('/')

    await clickSignIn(container)

    // CYJ-19: the mount also fires the /auth/me session check, so assert on
    // the start-endpoint call specifically, not the raw global count.
    const startCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/auth/google/start'),
    )
    expect(startCalls).toHaveLength(1)
    const [url, init] = startCalls[0] as unknown as [string, RequestInit]
    // CYJ-16: no flags in the URL → none appended to the start request
    expect(url).toBe('https://fn.example/auth/google/start')
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key-123')
    // ...and the browser follows the returned Google URL, never the endpoint itself
    expect(navCalls.urls).toEqual([googleUrl])
    expect(navCalls.urls[0]).not.toContain('/auth/google/start')
  })

  it('endpoint failure: shows an error alert, navigates nowhere, no silent mock fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 }))),
    )
    const container = await renderLanding('/')

    await clickSignIn(container)

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sign-in failed')
    expect(navCalls.urls).toEqual([])
    // still on the landing screen — the mock /lobby navigate must NOT fire
    expect(container.querySelector('.landing-google')).not.toBeNull()
    expect(container.textContent).not.toContain('lobby-destination')
  })

  // CYJ-16: the functions URL is the only remaining gate — unconfigured local
  // dev keeps the mock /lobby navigate instead of fetching a bogus URL.
  it('functions URL unconfigured: router-navigates to /lobby with zero network calls', async () => {
    configState.functionsUrl = ''
    try {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const container = await renderLanding('/')

      await clickSignIn(container)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(navCalls.urls).toEqual([])
      expect(container.textContent).toContain('lobby-destination')
    } finally {
      configState.functionsUrl = 'https://fn.example'
    }
  })
})
