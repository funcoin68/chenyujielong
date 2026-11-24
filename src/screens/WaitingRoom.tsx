import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { QUICK_CHAT } from '../mock/data'
import { fetchCurrentUser, type AuthUser } from '../auth/sessionClient'
import { fetchRoom, leaveRoom, type FetchRoomResult } from '../rooms/roomClient'
import './WaitingRoom.css'

/** S5 — Waiting Room. CYJ-24: renders the REAL room fetched from
 * room-authority — code, name and exactly the players in room_players. No
 * fixture fallback exists on any path: a failed or missing read renders a
 * visible error state (rule 12), never src/mock/data.ts room/player data.
 * CYJ-28: the settings gear goes to the real, route-backed settings screen. */
export default function WaitingRoom() {
  const navigate = useNavigate()
  const { roomId = '' } = useParams()
  const [copied, setCopied] = useState(false)
  // CYJ-32: the non-host Leave Room action. `leaving` guards double-clicks;
  // `leaveError` surfaces any failure (network or non-2xx) as a visible alert
  // — the player stays in the room on every failure path (AC #4).
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  // Tri-state (Lobby's CYJ-23 pattern): undefined = still resolving — the
  // loading branch renders NO room data, so fixture values can never leak
  // while the fetch is in flight.
  const [result, setResult] = useState<FetchRoomResult | undefined>(undefined)
  // The (you) marker needs the caller's id; resolved best-effort — a failed
  // /auth/me just leaves the marker absent (public read, no auth required).
  const [me, setMe] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchRoom(roomId).then((r) => {
      if (!cancelled) setResult(r)
    })
    fetchCurrentUser().then((user) => {
      if (!cancelled) setMe(user)
    })
    return () => {
      cancelled = true
    }
  }, [roomId])

  if (result === undefined) {
    return (
      <main className="waiting">
        <header className="waiting-topbar">
          <Link to="/lobby" className="btn btn-text">
            ← Lobby
          </Link>
        </header>
        <p>Loading room…</p>
      </main>
    )
  }

  if (result.kind !== 'ok') {
    return (
      <main className="waiting">
        <header className="waiting-topbar">
          <Link to="/lobby" className="btn btn-text">
            ← Lobby
          </Link>
        </header>
        <p role="alert">
          {result.kind === 'not-found' ? 'Room not found.' : result.message}
        </p>
      </main>
    )
  }

  const { room, players } = result
  // The fixture ready-states are gone — no ready concept exists server-side
  // (CYJ-24). Starting needs at least two real players.
  const canStart = players.length >= 2
  const emptySlots = Math.max(room.maxPlayers - players.length, 0)
  // CYJ-32: host-ness derives from room.ownerId — the SAME field the server
  // authorizes against (the CYJ-28 settings-screen pattern) — not from the
  // players list's isHost flag, so the client gate can't drift from
  // authorization. Only a signed-in non-host gets the Leave Room action;
  // hosts end the room via close-room (CYJ-23) and signed-out viewers have
  // no session to leave with (the server would 401 anyway).
  const isHost = me !== null && room.ownerId === me.id

  const leaveTheRoom = async () => {
    if (leaving) return
    setLeaving(true)
    setLeaveError(null)
    const res = await leaveRoom(roomId)
    setLeaving(false)
    if (res.kind === 'ok') {
      navigate('/lobby')
      return
    }
    setLeaveError(
      res.kind === 'unauthorized'
        ? 'Please sign in to leave the room.'
        : res.kind === 'forbidden'
          ? 'You cannot leave this room.'
          : res.kind === 'not-found'
            ? 'Room not found.'
            : res.message,
    )
  }

  const copyCode = () => {
    try {
      void navigator.clipboard?.writeText(room.code)
    } catch {
      /* clipboard unavailable — the code stays visible either way */
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="waiting">
      <header className="waiting-topbar">
        <div className="waiting-topbar-side">
          <Link to="/lobby" className="btn btn-text">
            ← Lobby
          </Link>
          {me && !isHost && (
            // CYJ-32: btn-outline (not the primary START GAME button) so a
            // leave can't be mistaken for starting the game.
            <button
              type="button"
              className="btn btn-outline waiting-leave"
              disabled={leaving}
              onClick={() => void leaveTheRoom()}
            >
              {leaving ? 'Leaving…' : 'Leave Room'}
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn btn-text"
          aria-label="Room settings"
          onClick={() => navigate(`/room/${roomId}/settings`)}
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

      {leaveError && (
        // AC #4: a failed leave is loud, never a silent no-op — the player
        // stays in the room and the error is announced to assistive tech.
        <p role="alert">{leaveError}</p>
      )}

      <section className="waiting-room-info" aria-labelledby="waiting-room-name">
        <h1 id="waiting-room-name" className="waiting-name">
          {room.name ?? 'Untitled room'}
        </h1>
        <button
          type="button"
          className="waiting-code"
          onClick={copyCode}
          aria-label={`Room code ${room.code.split('').join(' ')} — tap to copy`}
        >
          <span className="waiting-code-label">CODE:</span>
          {room.code.split('').map((ch, i) => (
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
          Players {players.length}/{room.maxPlayers}
        </h2>
        <ul className="waiting-player-list">
          {players.map((p, i) => (
            <li key={p.userId} className="card waiting-player">
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" width={44} height={44} />
              ) : (
                // The server sends no identity color — assign one by index,
                // matching the Lobby header pattern (var(--player-N)).
                <PlayerAvatar name={p.name} colorVar={`var(--player-${(i % 5) + 1})`} size={44} />
              )}
              <span className="waiting-player-name">
                {p.name}
                {me && p.userId === me.id && ' (you)'}
              </span>
              {p.isHost && <span className="chip">HOST</span>}
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
        title={canStart ? undefined : 'Need at least 2 players'}
        onClick={() => navigate(`/room/${roomId}/play`)}
      >
        START GAME (host)
      </button>
    </main>
  )
}
