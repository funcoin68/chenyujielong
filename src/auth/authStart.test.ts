import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildAuthStartUrl, startGoogleSignIn } from './authStart'

// The anon key is baked at build time; tests provide one. The getter pattern
// mirrors src/auth/sessionClient.test.ts.
const configState = vi.hoisted(() => ({ anonKey: 'anon-key-123' }))
vi.mock('../config', () => ({
  get SUPABASE_ANON_KEY() {
    return configState.anonKey
  },
}))

function stubFetch(res: Response) {
  const spy = vi.fn(() => Promise.resolve(res))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  configState.anonKey = 'anon-key-123'
  vi.unstubAllGlobals()
})

describe('buildAuthStartUrl', () => {
  it('targets the start endpoint with NO credential in the URL (CYJ-10: the apikey header carries it)', () => {
    const url = buildAuthStartUrl('https://fn.example', null)
    expect(url).toBe('https://fn.example/auth/google/start')
    expect(url).not.toContain('apikey')
  })

  it('preserves and URI-encodes the flags param so the CYJ-8 round-trip does not regress', () => {
    const url = buildAuthStartUrl('https://fn.example', 'flag-cyj-7,flag-cyj-8')
    expect(new URL(url).searchParams.get('flags')).toBe('flag-cyj-7,flag-cyj-8')
  })
})

describe('startGoogleSignIn (CYJ-10)', () => {
  it('fetches the start endpoint with the apikey header and credentials, resolving the returned redirect', async () => {
    const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc'
    const spy = stubFetch(
      new Response(JSON.stringify({ redirect: googleUrl }), { status: 200 }),
    )
    const url = await startGoogleSignIn('https://fn.example', 'flag-cyj-7')
    expect(url).toBe(googleUrl)
    expect(spy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(calledUrl).toBe('https://fn.example/auth/google/start?flags=flag-cyj-7')
    expect(init.headers).toMatchObject({ apikey: 'anon-key-123' })
    // the anti-CSRF state cookie is set from this cross-site response
    expect(init.credentials).toBe('include')
  })

  it('throws on a gateway 4xx instead of navigating', async () => {
    stubFetch(new Response('{"error":"unauthorized"}', { status: 401 }))
    await expect(startGoogleSignIn('https://fn.example', null)).rejects.toThrow(/401/)
  })

  it('throws on a server 5xx instead of navigating', async () => {
    stubFetch(new Response('{"error":"auth not configured"}', { status: 500 }))
    await expect(startGoogleSignIn('https://fn.example', null)).rejects.toThrow(/500/)
  })

  it('throws when the 200 body carries no redirect', async () => {
    stubFetch(new Response('{}', { status: 200 }))
    await expect(startGoogleSignIn('https://fn.example', null)).rejects.toThrow()
  })

  it('throws when the redirect is not an https: URL (it drives a top-level navigation)', async () => {
    stubFetch(new Response(JSON.stringify({ redirect: 'javascript:alert(1)' }), { status: 200 }))
    await expect(startGoogleSignIn('https://fn.example', null)).rejects.toThrow()
    stubFetch(new Response(JSON.stringify({ redirect: 'http://evil.example/' }), { status: 200 }))
    await expect(startGoogleSignIn('https://fn.example', null)).rejects.toThrow()
  })
})
