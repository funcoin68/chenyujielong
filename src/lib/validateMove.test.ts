import { describe, it, expect } from 'vitest'
import { validateMove } from './validateMove'

describe('validateMove', () => {
  it('accepts a move continuing the chain', () => {
    const result = validateMove({ previousIdiom: '一心一意', move: '意气风发' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ valid: true })
  })

  it('rejects a move breaking the chain', () => {
    const result = validateMove({ previousIdiom: '一心一意', move: '画蛇添足' })
    expect(result.status).toBe(400)
    expect(result.body.valid).toBe(false)
    expect(typeof (result.body as { reason?: string }).reason).toBe('string')
    expect((result.body as { reason?: string }).reason).not.toBe('')
  })

  it('rejects missing or empty input', () => {
    for (const input of [
      {},
      { previousIdiom: '', move: '意气风发' },
      { previousIdiom: '一心一意', move: '' },
      { previousIdiom: '   ', move: '意气风发' },
      { previousIdiom: 1, move: '意气风发' },
      { previousIdiom: '一心一意' },
      null,
      '一心一意',
    ]) {
      const result = validateMove(input)
      expect(result.status).toBe(400)
      expect(result.body.valid).toBe(false)
    }
  })

  it('accepts a chain after a trailing-punctuation idiom', () => {
    const result = validateMove({ previousIdiom: '一心一意。', move: '意气风发' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ valid: true })
  })
})
