// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
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

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount()
  vi.unstubAllGlobals()
})

describe('Lobby session consumption (CYJ-8 AC #4)', () => {
  it('with flag-cyj-7 and a valid session, greets the signed-in user and shows their avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))),
    )
    const container = await renderLobby('/lobby?flags=flag-cyj-7')
    expect(container.textContent).toContain(`Hi, ${USER.display_name}!`)
    const img = container.querySelector<HTMLImageElement>('.lobby-header img')
    expect(img?.getAttribute('src')).toBe(USER.avatar_url)
  })

  it('without the flag, renders the fixture identity and never calls the network', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const container = await renderLobby('/lobby')
    expect(container.textContent).toContain(`Hi, ${PROFILE.name}!`)
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
