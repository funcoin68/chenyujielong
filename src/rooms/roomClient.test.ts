import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoom, fetchActiveRoom, closeRoom, fetchRoomIdByCode, leaveRoom } from './roomClient'
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

const ACTIVE_ROOM = { roomId: 'r-1', code: 'AB23CD', name: 'My room', status: 'waiting' as const }

describe('fetchActiveRoom (CYJ-23)', () => {
  it('returns an error result without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(() => Promise.resolve(new Response('{"room":null}', { status: 200 })))
    const res = await fetchActiveRoom()
    expect(res).toEqual({ kind: 'error', message: 'game server is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves the active room on a 200 response', async () => {
    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ room: ACTIVE_ROOM }), { status: 200 })),
    )
    expect(await fetchActiveRoom()).toEqual({ kind: 'ok', room: ACTIVE_ROOM })
  })

  it('resolves to a null room when the server reports no active room', async () => {
    mockFetch(() => Promise.resolve(new Response('{"room":null}', { status: 200 })))
    expect(await fetchActiveRoom()).toEqual({ kind: 'ok', room: null })
  })

  it('maps a 401 to the unauthorized result (no session)', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await fetchActiveRoom()).toEqual({ kind: 'unauthorized' })
  })

  it('maps a non-ok response to an error result carrying the server message', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('{"error":"active room lookup failed"}', { status: 500 })),
    )
    const res = await fetchActiveRoom()
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('active room lookup failed')
  })

  it('rejects an invalid payload instead of trusting it (rule 9)', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ room: { roomId: 'r-1', code: 42 } }), { status: 200 }),
      ),
    )
    const res = await fetchActiveRoom()
    expect(res).toEqual({ kind: 'error', message: 'game server returned an invalid response' })
  })

  it('sends credentials and the stored session token to the active-room endpoint', async () => {
    saveSessionToken('tok-abc')
    const spy = mockFetch(() =>
      Promise.resolve(new Response('{"room":null}', { status: 200 })),
    )
    await fetchActiveRoom()
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/room-authority\/active-room$/)
    expect(init.method).toBeUndefined()
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-abc')
  })
})

describe('fetchRoomIdByCode (CYJ-31)', () => {
  it('returns an error result without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1' }), { status: 200 })),
    )
    const res = await fetchRoomIdByCode('AB23CD')
    expect(res).toEqual({ kind: 'error', message: 'game server is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves the room id on a 200 response', async () => {
    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1', code: 'AB23CD' }), { status: 200 })),
    )
    expect(await fetchRoomIdByCode('AB23CD')).toEqual({ kind: 'ok', roomId: 'r-1' })
  })

  it('maps a 404 to the distinct not-found result (unknown code → inline error)', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('{"error":"no room found for that code"}', { status: 404 })),
    )
    expect(await fetchRoomIdByCode('ZZZZZZ')).toEqual({ kind: 'not-found' })
  })

  it('maps a non-ok response to an error result carrying the server message', async () => {
    mockFetch(() =>
      Promise.resolve(new Response('{"error":"room lookup failed"}', { status: 500 })),
    )
    const res = await fetchRoomIdByCode('AB23CD')
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('room lookup failed')
  })

  it('rejects an invalid payload instead of trusting it (rule 9)', async () => {
    mockFetch(() => Promise.resolve(new Response(JSON.stringify({ roomId: 42 }), { status: 200 })))
    const res = await fetchRoomIdByCode('AB23CD')
    expect(res).toEqual({ kind: 'error', message: 'game server returned an invalid response' })
  })

  it('GETs the room-by-code endpoint with credentials and the stored token', async () => {
    saveSessionToken('tok-abc')
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1', code: 'AB23CD' }), { status: 200 })),
    )
    await fetchRoomIdByCode('AB23CD')
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/room-authority\/room-by-code\/AB23CD$/)
    expect(init.method).toBeUndefined()
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-abc')
  })
})

describe('closeRoom (CYJ-23)', () => {
  it('returns an error result without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))
    const res = await closeRoom('r-1')
    expect(res).toEqual({ kind: 'error', message: 'game server is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('POSTs the roomId to the close-room endpoint and resolves ok on 200', async () => {
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1', status: 'closed' }), { status: 200 })),
    )
    expect(await closeRoom('r-1')).toEqual({ kind: 'ok' })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/room-authority\/close-room$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ roomId: 'r-1' })
  })

  it('maps a 401 to unauthorized and a 403 to forbidden', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await closeRoom('r-1')).toEqual({ kind: 'unauthorized' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"not the room owner"}', { status: 403 }))),
    )
    expect(await closeRoom('r-1')).toEqual({ kind: 'forbidden' })
  })

  it('maps a non-ok response to an error result carrying the server message', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"room not found"}', { status: 404 })))
    const res = await closeRoom('r-1')
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('room not found')
  })
})

describe('leaveRoom (CYJ-32)', () => {
  it('returns an error result without a network call when FUNCTIONS_URL is not configured', async () => {
    configState.functionsUrl = ''
    const spy = mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))
    const res = await leaveRoom('r-1')
    expect(res).toEqual({ kind: 'error', message: 'game server is not configured' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('POSTs the roomId to the leave-room endpoint and resolves ok on 200', async () => {
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1', left: true }), { status: 200 })),
    )
    expect(await leaveRoom('r-1')).toEqual({ kind: 'ok' })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/room-authority\/leave-room$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ roomId: 'r-1' })
  })

  it('maps 401 to unauthorized, 403 to forbidden, and 404 to not-found', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 })))
    expect(await leaveRoom('r-1')).toEqual({ kind: 'unauthorized' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"not a room player"}', { status: 403 }))),
    )
    expect(await leaveRoom('r-1')).toEqual({ kind: 'forbidden' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"error":"room not found"}', { status: 404 }))),
    )
    expect(await leaveRoom('r-1')).toEqual({ kind: 'not-found' })
  })

  it('maps a non-ok response to an error result carrying the server message', async () => {
    mockFetch(() => Promise.resolve(new Response('{"error":"room leave failed"}', { status: 500 })))
    const res = await leaveRoom('r-1')
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('room leave failed')
  })

  it('maps a non-JSON error body to an error result with the HTTP status', async () => {
    mockFetch(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })))
    const res = await leaveRoom('r-1')
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('HTTP 502')
  })

  it('maps a network rejection to a network-error message (AC #4)', async () => {
    mockFetch(() => Promise.reject(new Error('connection refused')))
    const res = await leaveRoom('r-1')
    expect(res.kind).toBe('error')
    if (res.kind === 'error') expect(res.message).toContain('network error')
  })

  it('sends the stored session token as x-cyj-session', async () => {
    saveSessionToken('tok-abc')
    const spy = mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ roomId: 'r-1', left: true }), { status: 200 })),
    )
    await leaveRoom('r-1')
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).get('x-cyj-session')).toBe('tok-abc')
  })
})
