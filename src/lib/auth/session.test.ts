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

describe('session expiry (AC #5 lookup half)', () => {
  it('expires 14 days from issuance', () => {
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
