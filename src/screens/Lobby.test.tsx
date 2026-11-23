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
// flag-cyj-7 session fetch is enabled (production sets VITE_FUNCTIONS_URL).
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

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount()
  vi.unstubAllGlobals()
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

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

  // Review round: with the flag off the consume effect must not persist the
  // token — the flag's blast radius stays clean even if a fragment arrives.
  it('with the flag off, never persists a cyj_session fragment', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby#cyj_session=tok-from-callback')
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(container.textContent).toContain(`Hi, ${PROFILE.name}!`)
  })
})
