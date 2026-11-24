import { describe, it, expect } from 'vitest'
import { capitalizeName } from './capitalizeName.ts'

describe('capitalizeName', () => {
  it('capitalizes each whitespace-separated token', () => {
    expect(capitalizeName('wei chen')).toBe('Wei Chen')
  })

  it('is idempotent on already-capitalized names', () => {
    expect(capitalizeName('Wei Chen')).toBe('Wei Chen')
    expect(capitalizeName(capitalizeName('wei chen'))).toBe('Wei Chen')
  })

  it('capitalizes a single name', () => {
    expect(capitalizeName('wei')).toBe('Wei')
  })

  it('leaves CJK-only names unchanged (no case to apply)', () => {
    expect(capitalizeName('小明')).toBe('小明')
  })

  it('passes through the empty string', () => {
    expect(capitalizeName('')).toBe('')
  })

  it('tolerates multiple consecutive spaces', () => {
    expect(capitalizeName('wei  chen')).toBe('Wei  Chen')
  })
})
