import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Modal } from './Modal'

describe('Modal (spec §5: Esc + backdrop close, labelled dialog)', () => {
  it('renders nothing when closed', () => {
    expect(
      renderToString(
        <Modal open={false} onClose={() => {}} title="How to play">
          <p>body</p>
        </Modal>,
      ),
    ).toBe('')
  })

  it('exposes dialog semantics and an accessible name when open', () => {
    const html = renderToString(
      <Modal open={true} onClose={() => {}} title="How to play">
        <p>body</p>
      </Modal>,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toContain('How to play')
    expect(html).toContain('body')
  })

  it('has a real <button> close control with an accessible label', () => {
    const html = renderToString(
      <Modal open={true} onClose={() => {}} title="Create Room">
        <p>body</p>
      </Modal>,
    )
    expect(html).toMatch(/<button[^>]*aria-label="Close"/)
  })
})
