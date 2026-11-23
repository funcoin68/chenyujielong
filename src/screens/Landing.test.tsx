// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Landing from './Landing'

// The functions URL + anon key are baked at build time; tests provide both so
// the flag-cyj-7 sign-in path is enabled (mirrors Lobby.test.tsx).
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
// so tests stub a deterministic in-memory Storage (CYJ-14 assertions).
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const roots: Root[] = []

async function renderLanding(route: string): Promise<HTMLElement> {
  vi.stubGlobal('localStorage', memoryStorage())
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

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount()
  navCalls.urls.length = 0
  navCalls.storedStates.length = 0
  vi.unstubAllGlobals()
})

describe('Landing Google sign-in (CYJ-14 AC #1)', () => {
  it('flag on: persists the OAuth state nonce to durable storage BEFORE navigating to Google', async () => {
    const googleUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fauth%2Fcallback&state=abc'
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
      ),
    )
    const container = await renderLanding('/?flags=flag-cyj-7')

    await clickSignIn(container)

    // AC #1: the nonce is in localStorage at the moment navigateTo fires,
    // and it survives after — durable across the Google round-trip.
    expect(navCalls.storedStates).toEqual(['abc'])
    expect(localStorage.getItem('cyj_oauth_state')).toBe('abc')
    expect(navCalls.urls).toEqual([googleUrl])
  })
})

describe('Landing Google sign-in (CYJ-10 AC #4)', () => {
  it('flag on: clicking sign-in calls the start endpoint programmatically and navigates to the redirect it returns', async () => {
    const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc'
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const container = await renderLanding('/?flags=flag-cyj-7')

    await clickSignIn(container)

    // the start endpoint was hit via fetch — not via top-level navigation
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fn.example/auth/google/start?flags=flag-cyj-7')
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key-123')
    // ...and the browser follows the returned Google URL, never the endpoint itself
    expect(navCalls.urls).toEqual([googleUrl])
    expect(navCalls.urls[0]).not.toContain('/auth/google/start')
  })

  it('flag on + endpoint failure: shows an error alert, navigates nowhere, no silent mock fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 }))),
    )
    const container = await renderLanding('/?flags=flag-cyj-7')

    await clickSignIn(container)

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Sign-in failed')
    expect(navCalls.urls).toEqual([])
    // still on the landing screen — the mock /lobby navigate must NOT fire
    expect(container.querySelector('.landing-google')).not.toBeNull()
    expect(container.textContent).not.toContain('lobby-destination')
  })

  it('flag off: router-navigates to /lobby with zero network calls', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const container = await renderLanding('/')

    await clickSignIn(container)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(navCalls.urls).toEqual([])
    expect(container.textContent).toContain('lobby-destination')
  })
})
