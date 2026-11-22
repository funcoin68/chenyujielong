import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchCurrentUser } from './sessionClient'

// The functions URL is baked at build time; tests provide one. The getter
// lets a test flip it to '' to exercise the not-configured guard.
const configState = vi.hoisted(() => ({ functionsUrl: 'https://fn.example' }))
vi.mock('../config', () => ({
  get FUNCTIONS_URL() {
    return configState.functionsUrl
  },
}))

const USER = {
  id: 'u-1',
  email: 'player@example.com',
  display_name: 'Test Player',
  avatar_url: 'https://example.com/p.png',
}

function mockFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  configState.functionsUrl = 'https://fn.example'
})

describe('fetchCurrentUser', () => {
  it('resolves null without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))
    expect(await fetchCurrentUser()).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves the signed-in user on a 200 response', async () => {
    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })),
    )
    expect(await fetchCurrentUser()).toEqual(USER)
  })

  it('sends the session cookie (credentials: include) to the /auth/me endpoint', async () => {
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })),
    )
    await fetchCurrentUser()
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/auth\/me$/)
    expect(init.credentials).toBe('include')
  })

  it('resolves null on a 401 (no session)', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await fetchCurrentUser()).toBeNull()
  })

  it('resolves null when the network request throws', async () => {
    mockFetch(() => Promise.reject(new Error('network down')))
    expect(await fetchCurrentUser()).toBeNull()
  })

  it('resolves null when a 200 body carries no user', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))
    expect(await fetchCurrentUser()).toBeNull()
  })

  it('drops a non-https avatar_url so arbitrary schemes never reach <img src>', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: { ...USER, avatar_url: 'javascript:alert(1)' } }), {
          status: 200,
        }),
      ),
    )
    expect((await fetchCurrentUser())?.avatar_url).toBeNull()
  })

  it('drops an avatar_url that is not a parseable URL', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: { ...USER, avatar_url: 'not a url' } }), {
          status: 200,
        }),
      ),
    )
    expect((await fetchCurrentUser())?.avatar_url).toBeNull()
  })
})
