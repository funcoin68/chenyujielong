// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
