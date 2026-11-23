import { describe, it, expect } from 'vitest'
import { generateRoomCode } from './code.ts'

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
