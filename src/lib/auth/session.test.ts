import { describe, it, expect } from 'vitest'
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
  isSessionExpired,
  serializeSessionCookie,
  serializeStateCookie,
  clearStateCookie,
  parseCookies,
  resolveSessionToken,
  resolveUserId,
} from './session'

describe('session tokens', () => {
  it('generates unique, URL-safe tokens', () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(a).not.toBe(b)
    // 32 bytes -> 43 base64url chars; must survive cookie/header transport
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes deterministically to 64 hex chars (SHA-256)', async () => {
    const token = generateSessionToken()
    const h1 = await hashSessionToken(token)
    const h2 = await hashSessionToken(token)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashSessionToken(generateSessionToken())).not.toBe(h1)
  })
})

describe('session cookies', () => {
  it('serializes the session cookie httpOnly, Secure, SameSite=None, 14d (AC #1)', () => {
    const cookie = serializeSessionCookie('tok123')
    expect(cookie).toContain(`${SESSION_COOKIE}=tok123`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
  })

  it('serializes the OAuth state cookie httpOnly, SameSite=None, with a 10-minute TTL (CYJ-10: set from a cross-site fetch response)', () => {
    const cookie = serializeStateCookie('state123')
    expect(cookie).toContain(`${STATE_COOKIE}=state123`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Max-Age=600')
  })

  it('clears the state cookie with Max-Age=0', () => {
    expect(clearStateCookie()).toContain(`${STATE_COOKIE}=;`)
    expect(clearStateCookie()).toContain('Max-Age=0')
  })

  it('parses a Cookie header back into name/value pairs', () => {
    const cookies = parseCookies(`${SESSION_COOKIE}=abc.def; other=1`)
    expect(cookies[SESSION_COOKIE]).toBe('abc.def')
    expect(cookies.other).toBe('1')
    expect(parseCookies(null)).toEqual({})
  })
})

describe('resolveSessionToken (CYJ-15: cookie ?? x-cyj-session fallback, AC #2/#3)', () => {
  it('uses the x-cyj-session header when no cookie arrives', () => {
    expect(resolveSessionToken(null, 'header-tok')).toBe('header-tok')
    expect(resolveSessionToken('', 'header-tok')).toBe('header-tok')
  })

  it('prefers the cookie when both arrive', () => {
    expect(resolveSessionToken(`${SESSION_COOKIE}=cookie-tok`, 'header-tok')).toBe('cookie-tok')
  })

  it('returns null when neither arrives — the Edge Function maps this to 401 {"error":"no session"}, never a 500', () => {
    expect(resolveSessionToken(null, null)).toBeNull()
    // A cookie header without the session cookie still falls through to the header.
    expect(resolveSessionToken('other=1', null)).toBeNull()
  })
})

describe('resolveUserId (CYJ-20: one shared session-resolution path for BOTH Edge Functions)', () => {
  const future = new Date(Date.now() + 60_000).toISOString()

  it('hashes the cookie token and returns the live row (kind: ok)', async () => {
    const token = generateSessionToken()
    const expectedHash = await hashSessionToken(token)
    const lookup = async (tokenHash: string) => {
      expect(tokenHash).toBe(expectedHash)
      return { user_id: 'u-1', expires_at: future }
    }
    const res = await resolveUserId(`${SESSION_COOKIE}=${token}`, null, lookup)
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(res.row.user_id).toBe('u-1')
  })

  it('falls back to the x-cyj-session header when no cookie arrives (CYJ-15 token rule)', async () => {
    const token = generateSessionToken()
    const expectedHash = await hashSessionToken(token)
    const lookup = async (tokenHash: string) => {
      expect(tokenHash).toBe(expectedHash)
      return { user_id: 'u-2', expires_at: future }
    }
    const res = await resolveUserId(null, token, lookup)
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(res.row.user_id).toBe('u-2')
  })

  it('prefers the cookie token when both cookie and header arrive', async () => {
    const cookieToken = generateSessionToken()
    const headerToken = generateSessionToken()
    const expectedHash = await hashSessionToken(cookieToken)
    const lookup = async (tokenHash: string) => {
      expect(tokenHash).toBe(expectedHash)
      return { user_id: 'u-cookie', expires_at: future }
    }
    const res = await resolveUserId(`${SESSION_COOKIE}=${cookieToken}`, headerToken, lookup)
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') expect(res.row.user_id).toBe('u-cookie')
  })

  it('never calls the lookup without any token (neither cookie nor header)', async () => {
    const lookup = () => {
      throw new Error('lookup must not run without a token')
    }
    await expect(resolveUserId(null, null, lookup)).resolves.toEqual({ kind: 'no-session' })
    await expect(resolveUserId('other=1', null, lookup)).resolves.toEqual({ kind: 'no-session' })
  })

  it('maps an unknown token hash to kind: no-session (malformed header tokens land here too)', async () => {
    await expect(
      resolveUserId(`${SESSION_COOKIE}=tok`, null, async () => null),
    ).resolves.toEqual({ kind: 'no-session' })
  })

  it('maps an expired row to kind: expired, preserving the row (the /auth/me caller needs it)', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const row = { user_id: 'u-1', expires_at: past }
    await expect(
      resolveUserId(`${SESSION_COOKIE}=tok`, null, async () => row),
    ).resolves.toEqual({ kind: 'expired', row })
  })

  it('passes the full row through on kind: ok so /auth/me’s users(...) join survives', async () => {
    const row = {
      user_id: 'u-1',
      expires_at: future,
      users: { id: 'u-1', email: 'a@b.c', display_name: null, avatar_url: null },
    }
    const res = await resolveUserId(`${SESSION_COOKIE}=tok`, null, async () => row)
    expect(res).toEqual({ kind: 'ok', row })
  })
})

describe('session expiry (AC #5 lookup half)', () => {  it('expires 14 days from issuance', () => {
    const now = new Date('2026-11-22T00:00:00Z')
    const expires = sessionExpiresAt(now)
    expect(expires.getTime() - now.getTime()).toBe(SESSION_MAX_AGE_SECONDS * 1000)
  })

  it('rejects expired sessions and accepts live ones', () => {
    const now = new Date()
    expect(isSessionExpired(new Date(now.getTime() - 1000), now)).toBe(true)
    expect(isSessionExpired(new Date(now.getTime() + 60_000), now)).toBe(false)
  })
})
