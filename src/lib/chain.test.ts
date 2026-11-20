import { describe, it, expect } from 'vitest'
import { firstChar, lastChar, isChainValid } from './chain'

describe('idiom chain primitives', () => {
  it('extracts the last character of an idiom', () => {
    expect(lastChar('一心一意')).toBe('意')
    expect(lastChar('  一心一意。')).toBe('意')
  })

  it('extracts the first character of a move', () => {
    expect(firstChar('意气风发')).toBe('意')
  })

  it('accepts a move continuing the chain', () => {
    expect(isChainValid('一心一意', '意气风发')).toBe(true)
  })

  it('rejects a move breaking the chain', () => {
    expect(isChainValid('一心一意', '画蛇添足')).toBe(false)
  })

  it('throws on empty input', () => {
    expect(() => lastChar('   ')).toThrow()
  })
})
