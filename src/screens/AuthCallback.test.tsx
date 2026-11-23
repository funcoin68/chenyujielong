// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import AuthCallback from './AuthCallback'

// FUNCTIONS_URL is baked at build time; tests provide it so the screen can
// build the cross-origin completion URL (mirrors Landing.test.tsx).
const configState = vi.hoisted(() => ({ functionsUrl: 'https://fn.example' }))
vi.mock('../config', () => ({
  get FUNCTIONS_URL() {
    return configState.functionsUrl
  },
}))

// jsdom's window.location.assign is non-configurable — intercept the
// navigateTo seam like Landing.test.tsx does, and capture the durable-storage
// value at navigation time to prove ordering (AC #1-style assertion).
const navCalls = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock('../auth/authStart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/authStart')>()),
  navigateTo: (url: string) => {
    navCalls.urls.push(url)
  },
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// The vitest jsdom env here exposes no localStorage (opaque-origin window),
// so tests stub a deterministic in-memory Storage.
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

// Renders the callback route plus a probe that displays wherever the
// app-internal navigation (useNavigate) landed, so tests can assert the
// /?auth_error=… bounce target.
function LocationProbe() {
  const location = useLocation()
  return <p data-testid="probe">{location.pathname + location.search}</p>
}

async function renderCallback(route: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  return container
}

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount()
  navCalls.urls.length = 0
  vi.unstubAllGlobals()
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

describe('AuthCallback (CYJ-14)', () => {
  // AC #2 (client hop): matching state drives the top-level navigation to the
  // function callback, carrying the code, the Google-echoed state, and the
  // client-verified stored value.
  it('matching state navigates to the function callback with code, state, and stored params', async () => {
    localStorage.setItem('cyj_oauth_state', 'abc')
    const container = await renderCallback('/auth/callback?code=authcode&state=abc')

    expect(navCalls.urls).toEqual([
      'https://fn.example/auth/google/callback?code=authcode&state=abc&stored=abc',
    ])
    expect(container.querySelector('[data-testid="probe"]')).toBeNull()
  })

  // AC #3: mismatched state bounces back to the landing screen with the
  // visible error banner source — and never reaches the function (no session
  // can be issued).
  it('mismatched state bounces to /?auth_error=state_mismatch with no function call', async () => {
    localStorage.setItem('cyj_oauth_state', 'expected')
    const container = await renderCallback('/auth/callback?code=authcode&state=attacker')

    expect(navCalls.urls).toEqual([])
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe(
      '/?auth_error=state_mismatch',
    )
  })

  // AC #3: missing state param — same visible failure, no session.
  it('missing state param bounces to /?auth_error=state_mismatch with no function call', async () => {
    localStorage.setItem('cyj_oauth_state', 'abc')
    const container = await renderCallback('/auth/callback?code=authcode')

    expect(navCalls.urls).toEqual([])
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe(
      '/?auth_error=state_mismatch',
    )
  })

  it('missing stored state (empty storage) bounces to /?auth_error=state_mismatch', async () => {
    const container = await renderCallback('/auth/callback?code=authcode&state=abc')

    expect(navCalls.urls).toEqual([])
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe(
      '/?auth_error=state_mismatch',
    )
  })

  it('Google error param bounces with that error and no function call', async () => {
    localStorage.setItem('cyj_oauth_state', 'abc')
    const container = await renderCallback('/auth/callback?error=access_denied&state=abc')

    expect(navCalls.urls).toEqual([])
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe(
      '/?auth_error=access_denied',
    )
  })

  // AC #4: the stored nonce is cleared by the validation attempt itself —
  // including failures, so a retry generates a fresh nonce at start.
  it('clears the stored state in every branch (single-use)', async () => {
    for (const route of [
      '/auth/callback?code=c&state=abc',
      '/auth/callback?code=c&state=wrong',
      '/auth/callback?code=c',
      '/auth/callback?error=access_denied&state=abc',
    ]) {
      localStorage.setItem('cyj_oauth_state', 'abc')
      const container = await renderCallback(route)
      expect(localStorage.getItem('cyj_oauth_state')).toBeNull()
      for (const root of roots.splice(0)) root.unmount()
      navCalls.urls.length = 0
      void container
    }
  })
})
