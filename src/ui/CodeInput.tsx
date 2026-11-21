import { useRef, useState } from 'react'
import './CodeInput.css'

export interface CodeInputProps {
  label: string
  onComplete: (code: string) => void
}

const LENGTH = 6

/**
 * Six large segment boxes (spec §5 CodeInput / S4): auto-advancing,
 * auto-submitting on the 6th char, paste-friendly.
 */
export function CodeInput({ label, onComplete }: CodeInputProps) {
  const [chars, setChars] = useState<string[]>(() => Array(LENGTH).fill(''))
  const refs = useRef<(HTMLInputElement | null)[]>([])

  const update = (next: string[]) => {
    setChars(next)
    if (next.every((c) => c !== '')) onComplete(next.join(''))
  }

  const handleChange = (i: number, value: string) => {
    const ch = value.replace(/[^a-zA-Z0-9]/g, '').slice(-1).toUpperCase()
    if (!ch) return
    const next = [...chars]
    next[i] = ch
    update(next)
    if (i < LENGTH - 1) refs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const next = [...chars]
      if (next[i]) {
        next[i] = ''
        update(next)
      } else if (i > 0) {
        next[i - 1] = ''
        update(next)
        refs.current[i - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < LENGTH - 1) {
      refs.current[i + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData
      .getData('text')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array(LENGTH).fill('')
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    update(next)
    refs.current[Math.min(text.length, LENGTH - 1)]?.focus()
  }

  return (
    <div className="code-input" role="group" aria-label={label}>
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="code-input-box"
          value={ch}
          inputMode="text"
          autoComplete="off"
          aria-label={`${label}, character ${i + 1} of ${LENGTH}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  )
}
