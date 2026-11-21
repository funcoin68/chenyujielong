import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { RoomSettings } from './RoomSettings'
import { PLAYERS, QUICK_CHAT, ROOM } from '../mock/data'
import './WaitingRoom.css'

/** S5 — Waiting Room (mock renders the host view). */
export default function WaitingRoom() {
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const emptySlots = ROOM.maxPlayers - PLAYERS.length
  const allReady = PLAYERS.filter((p) => !p.isHost).every((p) => p.ready)
  const waitingOn = PLAYERS.find((p) => !p.isHost && !p.ready)?.name
  const canStart = PLAYERS.length >= 2 && allReady

  const copyCode = () => {
    try {
      void navigator.clipboard?.writeText(ROOM.code)
    } catch {
      /* clipboard unavailable — the code stays visible either way */
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="waiting">
      <header className="waiting-topbar">
        <Link to="/lobby" className="btn btn-text">
          ← Lobby
        </Link>
        <button
          type="button"
          className="btn btn-text"
          aria-label="Room settings"
          onClick={() => setSettingsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          settings
        </button>
      </header>

      <section className="waiting-room-info" aria-labelledby="waiting-room-name">
        <h1 id="waiting-room-name" className="waiting-name">
          {ROOM.name}
        </h1>
        <button
          type="button"
          className="waiting-code"
          onClick={copyCode}
          aria-label={`Room code ${ROOM.code.split('').join(' ')} — tap to copy`}
        >
          <span className="waiting-code-label">CODE:</span>
          {ROOM.code.split('').map((ch, i) => (
            <span key={i} className="waiting-code-char" aria-hidden="true">
              {ch}
            </span>
          ))}
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <rect
                x="9"
                y="9"
                width="11"
                height="11"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                d="M5 15V5a1 1 0 0 1 1-1h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
        <span className="sr-only" role="status">
          {copied ? 'Code copied' : ''}
        </span>
        <button type="button" className="btn btn-outline">
          Share invite link
        </button>
      </section>

      <section aria-labelledby="waiting-players-heading">
        <h2 id="waiting-players-heading" className="waiting-section-title">
          Players {PLAYERS.length}/{ROOM.maxPlayers}
        </h2>
        <ul className="waiting-player-list">
          {PLAYERS.map((p) => (
            <li key={p.id} className="card waiting-player">
              <PlayerAvatar name={p.name} colorVar={p.colorVar} size={44} />
              <span className="waiting-player-name">
                {p.name}
                {p.isYou && ' (you)'}
              </span>
              {p.isHost && <span className="chip">HOST</span>}
              <span
                className={`waiting-ready${p.ready ? ' waiting-ready--yes' : ''}`}
                role="status"
              >
                {p.ready ? '✓ Ready' : '… thinking'}
              </span>
            </li>
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <li key={`empty-${i}`} className="waiting-player waiting-player--empty">
              <span className="waiting-empty-dot" aria-hidden="true" />
              <span className="waiting-empty-label">+ invite</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Quick chat">
        <div className="waiting-chat" role="group" aria-label="Quick chat presets">
          <span className="waiting-chat-label">Quick chat:</span>
          {QUICK_CHAT.map((phrase) => (
            <button key={phrase} type="button" className="chip waiting-chat-chip">
              {phrase}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="btn btn-primary btn-lg"
        disabled={!canStart}
        title={canStart ? undefined : waitingOn ? `Waiting for ${waitingOn}…` : 'Need at least 2 players'}
        onClick={() => navigate(`/room/${ROOM.id}/play`)}
      >
        START GAME (host)
      </button>

      {/* Host settings reopen the S3 form (spec S5) */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Room settings">
        <RoomSettings submitLabel="Save settings" onSubmit={() => setSettingsOpen(false)} />
      </Modal>
    </main>
  )
}
