// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import Lobby from './Lobby'
import { PROFILE } from '../mock/data'

// The functions URL is baked at build time; tests provide one so the
// session fetch is enabled (production sets VITE_FUNCTIONS_URL). CYJ-16
// retired the flag-cyj-7 gate — Lobby always consumes the session.
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
  // CYJ-16: Lobby always fetches /auth/me on mount — flush the microtask
  // queue so the session resolution's state update lands inside act().
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return container
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
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
})
