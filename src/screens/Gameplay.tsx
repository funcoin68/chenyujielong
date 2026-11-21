import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChainView } from '../ui/ChainView'
import { IdiomTile } from '../ui/IdiomTile'
import { Modal } from '../ui/Modal'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { TimerRing } from '../ui/TimerRing'
import { lastChar } from '../lib/chain'
import {
  ACTIVE_PLAYER_ID,
  CHAIN_CHAR_PINYIN,
  GAME_CHAIN,
  GAME_SCORES,
  PLAYERS,
  PLAYERS_BY_ID,
  ROOM,
  ROUND,
  SUGGESTIONS,
  type ChainEntry,
} from '../mock/data'
import './Gameplay.css'

/** S6 — Gameplay. Mock: submit appends to a local chain; no backend (AC #2). */
export default function Gameplay() {
  const navigate = useNavigate()
  const [chain, setChain] = useState<ChainEntry[]>(GAME_CHAIN)
  const chainChar = lastChar(chain[chain.length - 1].idiom)
  const pinyin = CHAIN_CHAR_PINYIN[chainChar] ?? ''
  const [input, setInput] = useState(chainChar)
  const [error, setError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const chainEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // auto-scroll the chain to the newest tile (spec S6)
  useEffect(() => {
    chainEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chain])

  // `/` focuses the input (spec S6 desktop keyboard)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const suggestions = SUGGESTIONS[chainChar] ?? []

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const chars = Array.from(input)
    if (chars.length < 4) return
    if (chars[0] !== chainChar) {
      reject(`Must start with 「${chainChar}」`)
      return
    }
    if (chars.length !== 4) {
      // mock dictionary: any 4-char string passes except obvious non-idioms
      reject(`「${input}」 不是成语 — not in dictionary`)
      return
    }
    const entry: ChainEntry = { idiom: input, pinyin: '', playerId: ACTIVE_PLAYER_ID, points: 10 }
    const next = [...chain, entry]
    setChain(next)
    const nextChar = lastChar(input)
    setInput(nextChar)
    setError(null)
    setHint(null)
  }

  const reject = (message: string) => {
    setError(message)
    setShaking(true)
    window.setTimeout(() => setShaking(false), 300)
  }

  const showHint = () => {
    const second = suggestions[0] ? Array.from(suggestions[0])[1] : '？'
    setHint(`${chainChar}_${second}_`)
  }

  return (
    <main className="game">
      <header className="game-topbar">
        <span className="chip">
          R{ROUND.current}/{ROUND.total}
        </span>
        <button
          type="button"
          className="game-icon-btn"
          aria-label="Game menu"
          onClick={() => setMenuOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M9 5v14M15 5v14"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button type="button" className="game-icon-btn" aria-label="Chat, 3 unread">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 4V6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="game-badge" aria-hidden="true">
            3
          </span>
        </button>
      </header>

      <ul className="game-rail" aria-label="Players">
        {PLAYERS.map((p) => {
          const active = p.id === ACTIVE_PLAYER_ID
          return (
            <li key={p.id} className={`game-rail-item${active ? ' game-rail-item--active' : ''}`}>
              {active ? (
                <TimerRing seconds={23} totalSeconds={ROOM.settings.turnSeconds} size={72}>
                  <PlayerAvatar name={p.name} colorVar={p.colorVar} size={52} active />
                </TimerRing>
              ) : (
                <PlayerAvatar name={p.name} colorVar={p.colorVar} size={48} />
              )}
              <span className="game-rail-name">
                {p.isYou ? 'YOU' : p.name}
                {active && <span className="sr-only">, their turn</span>}
              </span>
              <span className="game-rail-score">{GAME_SCORES[p.id]}</span>
            </li>
          )
        })}
      </ul>

      <section className="game-chain" aria-label="Idiom chain">
        <ChainView entries={chain} playersById={PLAYERS_BY_ID} headEmphasis animateNewest />
        <div className="game-current-slot">
          <IdiomTile text={`${chainChar}？？？`} size="slot" />
        </div>
        <div ref={chainEndRef} />
      </section>

      <p className="game-prompt" aria-live="polite">
        {`YOUR TURN — start with 「${chainChar}」${pinyin ? ` (${pinyin})` : ''}`}
      </p>

      <form className="game-input-row" onSubmit={submit}>
        <input
          ref={inputRef}
          className={`game-input${shaking ? ' game-input--shake' : ''}`}
          value={input}
          aria-label={`Your idiom, must start with ${chainChar}`}
          onChange={(e) => {
            // first character locked: rule enforced by construction (spec §6)
            const v = e.target.value
            setInput(v.startsWith(chainChar) ? v : chainChar)
          }}
        />
        <button
          type="submit"
          className="btn btn-primary game-submit"
          aria-label="Submit idiom"
          disabled={Array.from(input).length < 4}
        >
          ⏵
        </button>
      </form>
      {error && (
        <p className="game-error" role="alert">
          ✕ {error} — not quite, try another!
        </p>
      )}
      {hint && <p className="game-hint">Hint: {hint}</p>}

      <div className="game-suggestions" role="group" aria-label="Suggestion chips">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="chip game-suggestion"
            onClick={() => setInput(s)}
          >
            {s} <span className="game-suggestion-cost">½ pts</span>
          </button>
        ))}
        <button type="button" className="chip game-suggestion" onClick={showHint} disabled={!!hint}>
          ? hint
        </button>
      </div>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Game menu">
        <label className="game-menu-row">
          <input type="checkbox" defaultChecked /> Sound
        </label>
        <button type="button" className="btn btn-outline" onClick={() => setMenuOpen(false)}>
          Rules recap
        </button>
        <button
          type="button"
          className="btn btn-text game-menu-leave"
          onClick={() => navigate('/lobby')}
        >
          Leave game
        </button>
      </Modal>
    </main>
  )
}
