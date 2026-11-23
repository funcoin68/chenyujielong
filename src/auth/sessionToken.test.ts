// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SESSION_TOKEN_KEY, saveSessionToken, readSessionToken, clearSessionToken } from './sessionToken'
import { memoryStorage } from './memoryStorage'

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('sessionToken (CYJ-15)', () => {
  it('round-trips the session token through durable client storage', () => {
    saveSessionToken('tok-123')
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-123')
    expect(readSessionToken()).toBe('tok-123')
  })

  it('read with empty storage returns null and does not throw', () => {
    expect(readSessionToken()).toBeNull()
  })

  it('clear removes the stored token', () => {
    saveSessionToken('tok-123')
    clearSessionToken()
    expect(readSessionToken()).toBeNull()
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  it('overwrite on a fresh sign-in yields the fresh token', () => {
    saveSessionToken('old-tok')
    saveSessionToken('fresh-tok')
    expect(readSessionToken()).toBe('fresh-tok')
  })

  // The same third-party-cookie blocking that broke the session cookie can
  // also leave localStorage unavailable in hardened browsers — every call
  // must degrade to null/undefined rather than throw (rule 12).
  it('degrades without throwing when localStorage is unavailable', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', {
      get length() {
        return 0
      },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveSessionToken('tok')).not.toThrow()
    expect(readSessionToken()).toBeNull()
    expect(() => clearSessionToken()).not.toThrow()
  })
})
