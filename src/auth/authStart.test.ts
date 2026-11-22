import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildAuthStartUrl } from './authStart'

// The anon key is baked at build time; tests provide one. The getter pattern
// mirrors src/auth/sessionClient.test.ts.
const configState = vi.hoisted(() => ({ anonKey: 'anon-key-123' }))
vi.mock('../config', () => ({
  get SUPABASE_ANON_KEY() {
    return configState.anonKey
  },
}))

afterEach(() => {
  configState.anonKey = 'anon-key-123'
})

describe('buildAuthStartUrl', () => {
  it('appends the anon key as the apikey param when configured (AC #2)', () => {
    const url = buildAuthStartUrl('https://fn.example', null)
    expect(url).toBe('https://fn.example/auth/google/start?apikey=anon-key-123')
  })

  it('omits the apikey param entirely when the anon key is empty (no dangling apikey=)', () => {
    configState.anonKey = ''
    const url = buildAuthStartUrl('https://fn.example', null)
    expect(url).toBe('https://fn.example/auth/google/start')
    expect(url).not.toContain('apikey')
  })

  it('preserves and URI-encodes the flags param so the CYJ-8 round-trip does not regress', () => {
    const url = buildAuthStartUrl('https://fn.example', 'flag-cyj-7,flag-cyj-8')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('flags')).toBe('flag-cyj-7,flag-cyj-8')
    expect(parsed.searchParams.get('apikey')).toBe('anon-key-123')
  })

  it('produces a bare /auth/google/start when neither flags nor key are present', () => {
    configState.anonKey = ''
    expect(buildAuthStartUrl('https://fn.example', null)).toBe(
      'https://fn.example/auth/google/start',
    )
  })
})
