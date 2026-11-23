import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoom } from './roomClient'
import { saveSessionToken } from '../auth/sessionToken'
import { memoryStorage } from '../auth/memoryStorage'

// The functions URL is baked at build time; tests provide one. The getter
// lets a test flip it to '' to exercise the not-configured guard
// (same convention as src/auth/sessionClient.test.ts).
const configState = vi.hoisted(() => ({ functionsUrl: 'https://fn.example' }))
vi.mock('../config', () => ({
  get FUNCTIONS_URL() {
    return configState.functionsUrl
  },
}))

const SETTINGS = {
  name: 'Test Room',
  rule: 'strict' as const,
  turnSeconds: 60,
  maxPlayers: 4,
  winCondition: 'rounds' as const,
  dictionary: 'common' as const,
}

function mockFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

const okResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1' }), { status: 200 }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  configState.functionsUrl = 'https://fn.example'
})

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

describe('createRoom', () => {
  it('returns an error result without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(okResponse)
    const res = await createRoom(SETTINGS)
    expect(res).toEqual({ kind: 'error', message: 'game server is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves the created room id on a 200 response', async () => {
    mockFetch(okResponse)
    expect(await createRoom(SETTINGS)).toEqual({ kind: 'ok', roomId: 'r-1' })
  })

  it('maps a 401 to the unauthorized result (no session)', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await createRoom(SETTINGS)).toEqual({ kind: 'unauthorized' })
  })

  it('sends the session cookie (credentials: include) to the create-room endpoint', async () => {
    const spy = mockFetch(okResponse)
    await createRoom(SETTINGS)
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/room-authority\/create-room$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })
})

describe('createRoom — x-cyj-session header transport (CYJ-20)', () => {
  // AC #1: with a stored session token, the request must carry it — the
  // third-party-cookie blocking that broke the cross-site cyj_session cookie
  // never affects a header. Without this the room-authority fix never reaches
  // the server in those browsers.
  it('sends the stored session token as x-cyj-session', async () => {
    saveSessionToken('tok-abc')
    const spy = mockFetch(okResponse)
    await createRoom(SETTINGS)
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-abc')
  })

  it('sends no x-cyj-session header when no token is stored', async () => {
    const spy = mockFetch(okResponse)
    await createRoom(SETTINGS)
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBeNull()
  })
})
