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

describe('CYJ-5 static gradient background', () => {
  it('main.tsx imports the stylesheet', () => {
    expect(mainTsx).toMatch(/import\s+['"]\.\/index\.css['"]/)
  })

  it('defines a multi-stop linear gradient on body using :root custom properties', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
    const stops = [...rootBlock.matchAll(/--bg-stop-\d+\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
      (m) => m[1],
    )
    expect(stops.length).toBeGreaterThanOrEqual(3)
    const bodyBlock = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(bodyBlock).toMatch(/linear-gradient\(/)
    for (let i = 1; i <= stops.length; i++) {
      expect(bodyBlock).toContain(`var(--bg-stop-${i})`)
    }
  })

  it('pins the gradient to the viewport (fixed, no-repeat) so scrolling shows no seams', () => {
    const bodyBlock = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(bodyBlock).toMatch(/\bfixed\b/)
    expect(bodyBlock).toMatch(/\bno-repeat\b/)
  })

  it('covers the full viewport height', () => {
    expect(css).toMatch(/min-height:\s*100vh/)
  })

  it('loads no network assets for the background', () => {
    expect(css).not.toMatch(/url\(/)
  })

  it('applies no animation or transition to the background', () => {
    expect(css).not.toMatch(/@keyframes/)
    expect(css).not.toMatch(/\btransition\b/)
    expect(css).not.toMatch(/\banimation\b/)
  })

  it('keeps body text at WCAG AA contrast (>= 4.5:1) against every gradient stop', () => {
    const textColor = css.match(/color:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1]
    expect(textColor).toBeTruthy()
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
    const stops = [...rootBlock.matchAll(/--bg-stop-\d+\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
      (m) => m[1],
    )
    expect(stops.length).toBeGreaterThanOrEqual(3)
    for (const stop of stops) {
      const ratio = contrastRatio(textColor!, stop)
      expect(
        ratio,
        `contrast of text ${textColor} vs stop ${stop} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
