import { useEffect, useState } from 'react'
import './TimerRing.css'

export interface TimerRingProps {
  /** seconds remaining when the ring mounts */
  seconds: number
  /** full turn duration, for the depletion fraction */
  totalSeconds?: number
  size?: number
}

/**
 * Countdown ring around the active player's avatar (spec S6):
 * rAF-driven conic gradient, yellow at <=10s, red pulse at <=5s.
 * prefers-reduced-motion: numeric countdown only, no animation.
 */
export function TimerRing({ seconds, totalSeconds = 30, size = 72 }: TimerRingProps) {
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const left = Math.max(0, seconds - (now - start) / 1000)
      setRemaining(left)
      if (left > 0) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [seconds])

  const shown = Math.ceil(remaining)
  const fraction = Math.min(1, Math.max(0, remaining / totalSeconds))
  const color =
    shown <= 5 ? 'var(--error-coral)' : shown <= 10 ? 'var(--sun-yellow)' : 'var(--jade-green)'
  const ringStyle = {
    width: size,
    height: size,
    background: `conic-gradient(${color} ${fraction * 360}deg, var(--chain-link) 0deg)`,
  }

  return (
    <span className="timer-ring" role="timer" aria-label={`${shown} seconds left`}>
      <span
        className={`timer-ring-face${shown <= 5 ? ' timer-ring-face--urgent' : ''}`}
        style={ringStyle}
        aria-hidden="true"
      >
        <span className="timer-ring-hole" />
      </span>
      <span className="timer-ring-number" style={{ fontSize: size * 0.28 }}>
        {shown}
      </span>
    </span>
  )
}
