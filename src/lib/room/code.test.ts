import { describe, it, expect } from 'vitest'
import { generateRoomCode, isWellFormedRoomCode } from './code.ts'

describe('generateRoomCode', () => {
  it('generates a 6-character code', () => {
    expect(generateRoomCode()).toHaveLength(6)
  })

  it('uses only the unambiguous alphabet (no 0/O/1/I) across many draws', () => {
    // 200 draws make an alphabet-leak astronomically unlikely to slip through.
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    }
  })

  it('produces distinct codes (random source is live, not constant)', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(90)
  })
})

describe('isWellFormedRoomCode (CYJ-31)', () => {
  it('accepts generated codes (generator and validator cannot drift)', () => {
    for (let i = 0; i < 200; i++) {
      expect(isWellFormedRoomCode(generateRoomCode())).toBe(true)
    }
  })

  it('accepts alphabet boundary characters', () => {
    expect(isWellFormedRoomCode('ABCDEF')).toBe(true)
    expect(isWellFormedRoomCode('234567')).toBe(true)
  })

  it('rejects wrong lengths (empty, short, long)', () => {
    expect(isWellFormedRoomCode('')).toBe(false)
    expect(isWellFormedRoomCode('ABC')).toBe(false)
    expect(isWellFormedRoomCode('AB23C')).toBe(false)
    expect(isWellFormedRoomCode('AB23CDE')).toBe(false)
  })

  it('rejects the ambiguous characters removed from the alphabet', () => {
    expect(isWellFormedRoomCode('ABC0EF')).toBe(false)
    expect(isWellFormedRoomCode('ABCOEF')).toBe(false)
    expect(isWellFormedRoomCode('AB1DEF')).toBe(false)
    expect(isWellFormedRoomCode('ABIDEF')).toBe(false)
  })

  it('rejects lowercase (codes are uppercase by contract)', () => {
    expect(isWellFormedRoomCode('ab23cd')).toBe(false)
  })
})
