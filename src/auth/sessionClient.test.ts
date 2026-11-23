import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchCurrentUser } from './sessionClient'
import { saveSessionToken, readSessionToken, SESSION_TOKEN_KEY } from './sessionToken'
import { memoryStorage } from './memoryStorage'

// The functions URL is baked at build time; tests provide one. The getter
// lets a test flip it to '' to exercise the not-configured guard.
const configState = vi.hoisted(() => ({ functionsUrl: 'https://fn.example' }))
vi.mock('../config', () => ({
  get FUNCTIONS_URL() {
    return configState.functionsUrl
  },
  SUPABASE_ANON_KEY: 'anon-key',
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
  vi.restoreAllMocks()
  configState.functionsUrl = 'https://fn.example'
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

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

  it('resolves null with a warning when the network request throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => Promise.reject(new Error('network down')))
    expect(await fetchCurrentUser()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('resolves null with a warning when a 200 body carries no user', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))
    expect(await fetchCurrentUser()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('does not warn on a 401 — the normal signed-out path stays quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await fetchCurrentUser()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
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

describe('fetchCurrentUser — x-cyj-session header transport (CYJ-15)', () => {
  // AC #1 (the named unit-test gate): with a stored session token, the
  // request must carry it — the third-party-cookie blocking that broke the
  // cross-site cyj_session cookie never affects a header.
  it('sends the stored session token as x-cyj-session and the anon key as apikey', async () => {
    saveSessionToken('tok-abc')
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })),
    )
    await fetchCurrentUser()
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('x-cyj-session')).toBe('tok-abc')
    expect(headers.get('apikey')).toBe('anon-key')
    expect(init.credentials).toBe('include')
  })

  it('sends no x-cyj-session header when no token is stored', async () => {
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })),
    )
    await fetchCurrentUser()
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBeNull()
  })

  // AC #3: a wrong or expired token must not linger — every 401 (no session,
  // session expired) clears it so the next fetch is a clean signed-out call.
  it('clears the stored token on a 401 so it never lingers', async () => {
    saveSessionToken('tok-expired')
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await fetchCurrentUser()).toBeNull()
    expect(readSessionToken()).toBeNull()
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  it('keeps the stored token on a successful lookup', async () => {
    saveSessionToken('tok-live')
    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })),
    )
    expect(await fetchCurrentUser()).toEqual(USER)
    expect(readSessionToken()).toBe('tok-live')
  })
})
