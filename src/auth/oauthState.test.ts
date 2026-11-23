// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OAUTH_STATE_KEY, saveOauthState, takeOauthState } from './oauthState'
import { memoryStorage } from './memoryStorage'

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => vi.unstubAllGlobals())

describe('oauthState (CYJ-14)', () => {
  it('round-trips the state nonce through durable client storage', () => {
    saveOauthState('nonce-123')
    expect(localStorage.getItem(OAUTH_STATE_KEY)).toBe('nonce-123')
    expect(takeOauthState()).toBe('nonce-123')
  })

  // AC #4: single-use — the value is cleared by the read, so a replayed
  // callback cannot validate against it a second time.
  it('clears the stored value on take (single-use)', () => {
    saveOauthState('nonce-123')
    expect(takeOauthState()).toBe('nonce-123')
    expect(takeOauthState()).toBeNull()
    expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull()
  })

  it('overwrite on retry yields the fresh nonce', () => {
    saveOauthState('stale-nonce')
    saveOauthState('fresh-nonce')
    expect(takeOauthState()).toBe('fresh-nonce')
  })

  it('take with empty storage returns null', () => {
    expect(takeOauthState()).toBeNull()
  })
})
