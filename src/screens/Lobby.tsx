import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CodeInput } from '../ui/CodeInput'
import { Modal } from '../ui/Modal'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { RoomSettings } from './RoomSettings'
import { LOBBY_ROOMS, PROFILE, RECENT_GAMES, ROOM } from '../mock/data'
import './Lobby.css'

const MEDALS = ['🥇', '🥈', '🥉']

/** S2 — Lobby (Home). */
export default function Lobby() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  return (
    <main className="lobby">
      <header className="lobby-header">
        <span className="lobby-wordmark">成语接龙</span>
        <div className="lobby-header-actions">
          <button type="button" className="lobby-icon-btn" aria-label="Notifications">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <Link to="/profile" className="lobby-avatar-link" aria-label={`Profile of ${PROFILE.name}`}>
            <PlayerAvatar name={PROFILE.name} colorVar="var(--player-4)" size={40} />
            <span className="lobby-presence" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="lobby-columns">
        <section className="lobby-actions" aria-label="Actions">
          <p className="lobby-greeting">
            Hi, {PROFILE.name}! Ready to chain? 🔥 streak: {PROFILE.streak}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => navigate(`/room/${ROOM.id}`)}
          >
            ▶ Quick Play
          </button>
          <div className="lobby-secondary">
            <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(true)}>
              + Create Room
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setJoinOpen(true)}>
              # Join Code
            </button>
          </div>
        </section>

        <section className="lobby-rooms" aria-labelledby="lobby-rooms-heading">
          <h2 id="lobby-rooms-heading" className="lobby-section-title">
            Friends&apos; rooms ({LOBBY_ROOMS.length})
          </h2>
          <ul className="lobby-room-list">
            {LOBBY_ROOMS.map((room) => (
              <li key={room.name} className="card lobby-room">
                <div className="lobby-room-info">
                  <span className="lobby-room-name">{room.name}</span>
                  <span className="lobby-room-meta">
                    <span className="chip">{room.occupancy}</span>
                    <span className="chip">
                      {room.status === 'waiting' ? 'waiting' : 'in progress'}
                    </span>
                    {room.modes.map((m) => (
                      <span key={m} className="chip">
                        {m}
                      </span>
                    ))}
                  </span>
                </div>
                {room.status === 'waiting' ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => navigate(`/room/${ROOM.id}`)}
                  >
                    Join
                  </button>
                ) : (
                  <button type="button" className="btn btn-outline" disabled>
                    In progress
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="lobby-recent" aria-labelledby="lobby-recent-heading">
          <h2 id="lobby-recent-heading" className="lobby-section-title">
            Recent games
          </h2>
          <ul className="lobby-room-list">
            {RECENT_GAMES.map((g) => (
              <li key={g.date}>
                <Link to={`/room/${ROOM.id}/results`} className="card lobby-recent-row">
                  <span aria-hidden="true">{MEDALS[g.placement - 1] ?? `#${g.placement}`}</span>
                  <span>
                    {g.placement === 1 ? '1st' : g.placement === 2 ? '2nd' : `${g.placement}th`} ·{' '}
                    {g.playerCount} players
                  </span>
                  <span className="lobby-recent-date">{g.date}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* S3 — Create Room modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Room">
        <RoomSettings submitLabel="Create Room" onSubmit={() => navigate(`/room/${ROOM.id}`)} />
      </Modal>

      {/* S4 — Join with Code modal */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with Code">
        <CodeInput label="Room code" onComplete={() => navigate(`/room/${ROOM.id}`)} />
        <p className="lobby-join-hint">or open an invite link</p>
      </Modal>
    </main>
  )
}
