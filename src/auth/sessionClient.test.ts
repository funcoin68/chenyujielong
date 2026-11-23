import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchCurrentUser, invalidateSessionCache, signOutClient } from './sessionClient'
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
  const spy = vi.fn<typeof fetch>(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  configState.functionsUrl = 'https://fn.example'
})

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // CYJ-26: fetchCurrentUser caches per token — without a reset the cache
  // leaks between tests and produces false passes (rule 9).
  invalidateSessionCache()
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

describe('fetchCurrentUser — session cache (CYJ-26)', () => {
  const okStub = () =>
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 })))

  it('AC #1: a second call with the same token reuses the cache — no second fetch, same identity', async () => {
    const spy = okStub()
    expect(await fetchCurrentUser()).toEqual(USER)
    expect(await fetchCurrentUser()).toEqual(USER)
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(1)
  })

  it('AC #2: two calls while the first is in-flight share one fetch and both get the same user', async () => {
    let resolveFetch!: (res: Response) => void
    const spy = mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const first = fetchCurrentUser()
    const second = fetchCurrentUser()
    resolveFetch(new Response(JSON.stringify({ user: USER }), { status: 200 }))
    const [userA, userB] = await Promise.all([first, second])
    expect(userA).toEqual(USER)
    expect(userB).toEqual(USER)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a token change between calls misses the cache and refetches', async () => {
    const spy = okStub()
    saveSessionToken('tok-before')
    await fetchCurrentUser()
    saveSessionToken('tok-after')
    await fetchCurrentUser()
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(2)
  })

  it('a token change while a request is in-flight starts a fresh fetch for the new token — never the stale in-flight promise', async () => {
    const USER_B = { ...USER, id: 'u-2', email: 'other@example.com' }
    let call = 0
    let resolveFirst!: (res: Response) => void
    let resolveSecond!: (res: Response) => void
    const spy = mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          call += 1
          if (call === 1) resolveFirst = resolve
          else resolveSecond = resolve
        }),
    )
    saveSessionToken('tok-old')
    const stale = fetchCurrentUser()
    saveSessionToken('tok-new')
    const fresh = fetchCurrentUser()
    expect(spy).toHaveBeenCalledTimes(2)
    const [, secondInit] = spy.mock.calls[1] as unknown as [string, RequestInit]
    expect(new Headers(secondInit.headers).get('x-cyj-session')).toBe('tok-new')
    // The old request settling late only writes a cache entry keyed on
    // tok-old; the new token's identity is never cross-contaminated.
    resolveFirst(new Response(JSON.stringify({ user: USER }), { status: 200 }))
    resolveSecond(new Response(JSON.stringify({ user: USER_B }), { status: 200 }))
    expect(await stale).toEqual(USER)
    expect(await fresh).toEqual(USER_B)
    // The cache holds the new token's identity: no third fetch.
    expect(await fetchCurrentUser()).toEqual(USER_B)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('AC #4: a 401 clears the cached session, propagates null, and the next call refetches', async () => {
    saveSessionToken('tok-expired')
    const spy = mockFetch(() =>
      Promise.resolve(new Response('{"error":"no session"}', { status: 401 })),
    )
    expect(await fetchCurrentUser()).toBeNull()
    expect(readSessionToken()).toBeNull()
    // Signed-out state is cached under the cleared token's key, so this call
    // (no token stored) misses and refetches — the failure is never cached
    // as a success.
    expect(await fetchCurrentUser()).toBeNull()
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(2)
  })

  it('a cached signed-out (anonymous 401) state is reused without refetching', async () => {
    const spy = mockFetch(() =>
      Promise.resolve(new Response('{"error":"no session"}', { status: 401 })),
    )
    expect(await fetchCurrentUser()).toBeNull()
    expect(await fetchCurrentUser()).toBeNull()
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(1)
  })

  it('a network throw is never cached — the next call retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spy = mockFetch(() => Promise.reject(new Error('network down')))
    expect(await fetchCurrentUser()).toBeNull()
    expect(await fetchCurrentUser()).toBeNull()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('AC #3: invalidateSessionCache makes the next call refetch', async () => {
    const spy = okStub()
    expect(await fetchCurrentUser()).toEqual(USER)
    invalidateSessionCache()
    expect(await fetchCurrentUser()).toEqual(USER)
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(2)
  })

  it('AC #3: signOutClient clears the stored token and cache — the next call is a fresh fetch, not the stale identity', async () => {
    saveSessionToken('tok-live')
    let signedIn = true
    const spy = mockFetch(() =>
      Promise.resolve(
        new Response(
          signedIn ? JSON.stringify({ user: USER }) : '{"error":"no session"}',
          { status: signedIn ? 200 : 401 },
        ),
      ),
    )
    expect(await fetchCurrentUser()).toEqual(USER)
    signOutClient()
    expect(readSessionToken()).toBeNull()
    signedIn = false
    expect(await fetchCurrentUser()).toBeNull()
    const meCalls = spy.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))
    expect(meCalls).toHaveLength(2)
  })
})
