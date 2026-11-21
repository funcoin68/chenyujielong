/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'index.css'), 'utf8')
const mainTsx = readFileSync(resolve(here, 'main.tsx'), 'utf8')

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** Hex fallback value of a CSS custom property in the :root block. */
function tokenHex(name: string): string {
  const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
  const hex = rootBlock.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]
  expect(hex, `expected ${name} to be defined in :root with a hex fallback`).toBeTruthy()
  return hex!
}

const SPEC_TOKENS = [
  '--bg-canvas',
  '--bg-surface',
  '--ink-primary',
  '--ink-secondary',
  '--brand-red',
  '--brand-red-pressed',
  '--sun-yellow',
  '--jade-green',
  '--sky-blue',
  '--error-coral',
  '--chain-link',
]

describe('design tokens (spec §2.2–2.4)', () => {
  it('main.tsx imports the stylesheet', () => {
    expect(mainTsx).toMatch(/import\s+['"]\.\/index\.css['"]/)
  })

  it('defines every spec §2.2 color token as a custom property with a hex fallback', () => {
    for (const token of SPEC_TOKENS) tokenHex(token)
  })

  it('pairs each color token with an OKLCH value per spec §2.2', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
    for (const token of SPEC_TOKENS) {
      expect(rootBlock).toMatch(new RegExp(`${token}\\s*:\\s*oklch\\(`))
    }
  })

  it('keeps primary body text at WCAG AA (>= 4.5:1) against the canvas', () => {
    const ratio = contrastRatio(tokenHex('--ink-primary'), tokenHex('--bg-canvas'))
    expect(ratio, `ink-primary vs bg-canvas is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps secondary text at WCAG AA (>= 4.5:1) against the canvas', () => {
    const ratio = contrastRatio(tokenHex('--ink-secondary'), tokenHex('--bg-canvas'))
    expect(ratio, `ink-secondary vs bg-canvas is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  // The spec (§2.2) requires all six player identity colors at >= 3:1 vs bg-canvas.
  // Its sample hexes for P2/P3/P4/P6 fail that requirement, so the shipped tokens
  // are darkened variants of the same hues (documented deviation in the CYJ-6 PR).
  it('keeps all six player identity colors at >= 3:1 against the canvas (spec §2.2 claim)', () => {
    for (let i = 1; i <= 6; i++) {
      const hex = tokenHex(`--player-${i}`)
      const ratio = contrastRatio(hex, tokenHex('--bg-canvas'))
      expect(ratio, `player-${i} ${hex} vs canvas is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('ships the spec §2.3 CJK fallback stack', () => {
    expect(css).toContain("'ZCOOL KuaiLe'")
    for (const face of ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC']) {
      expect(css).toContain(`'${face}'`)
    }
  })

  it('honors prefers-reduced-motion (spec §2.5)', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('keeps the stylesheet free of network assets', () => {
    expect(css).not.toMatch(/url\(/)
  })
})
