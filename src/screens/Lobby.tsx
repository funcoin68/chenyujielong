import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CodeInput } from '../ui/CodeInput'
import { Modal } from '../ui/Modal'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { RoomSettings, defaultRoomName, type RoomSettingsValues } from './RoomSettings'
import { LOBBY_ROOMS, PROFILE, RECENT_GAMES, ROOM } from '../mock/data'
import { fetchCurrentUser, type AuthUser } from '../auth/sessionClient'
import { saveSessionToken } from '../auth/sessionToken'
import { closeRoom, createRoom, fetchActiveRoom, fetchRoomIdByCode, type ActiveRoom } from '../rooms/roomClient'
import './Lobby.css'

const MEDALS = ['🥇', '🥈', '🥉']
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)

/** S2 — Lobby (Home). */
export default function Lobby() {
  const navigate = useNavigate()
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  // Consume the OAuth session (CYJ-8) on every mount — CYJ-16 retired the
  // flag-cyj-7 gate, and the OAuth callback redirects to /lobby with no flags
  // in the URL. No session / any fetch failure leaves authUser null and the
  // render identical to the mock — AC: no visible change to the default view.
  // (The FUNCTIONS_URL check lives inside fetchCurrentUser — one home.)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  // CYJ-15: the sign-in success redirect hands the raw session token in a
  // #cyj_session URL FRAGMENT (flow.ts — a query string would leak the
  // long-lived token into server logs/history/Referer). Consume it BEFORE
  // the session fetch, store it durably so fetchCurrentUser attaches it as
  // the x-cyj-session header, and strip it via a router replace before it
  // lands in browser history — the token is a one-shot hand-off, not a
  // bookmarkable credential. Stripping is NOT flag-gated: the invariant
  // must hold unconditionally, so a token-bearing URL never sits in the
  // address bar/history. CYJ-16 retired flag-cyj-7, so the persist is
  // unconditional too — the OAuth callback lands on /lobby flagless.
  // Separate from the fetch effect so stripping the fragment (a location
  // change) cannot retrigger the fetch.
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get('cyj_session')
    if (!token) return
    saveSessionToken(token)
    // The replace preserves location.state, so a one-shot notice handed over
    // via router state (CYJ-28) survives the strip instead of depending on
    // the two mechanisms never overlapping (round-2 review, Lobby.tsx:78).
    navigate(location.pathname + location.search, { replace: true, state: location.state })
  }, [location, navigate])
  useEffect(() => {
    let cancelled = false
    fetchCurrentUser().then(async (user) => {
      if (cancelled) return
      setAuthUser(user)
      // CYJ-23: only signed-in users have the "Your active room" section, and
      // the endpoint 401s without a session — so the read is chained off a
      // successful session resolution, never fired for anonymous visitors.
      if (!user) return
      const result = await fetchActiveRoom()
      if (cancelled) return
      if (result.kind === 'ok') {
        setActiveRoom(result.room)
      } else if (result.kind === 'unauthorized') {
        // Session expired between the /auth/me read and this fetch — surface
        // it (rule 12), never render a false "No active room".
        setActiveRoomError('Please sign in to view your active room.')
      } else {
        setActiveRoomError(result.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  const displayName = authUser?.display_name ?? PROFILE.name

  // CYJ-28: screens that redirect here (e.g. a failed room read on the
  // settings route) hand over a one-shot notice via router location state.
  // The fragment-strip effect above preserves state across its replace, so
  // this read is safe on every path — covered by the regression test
  // 'survives the cyj_session fragment strip' in Lobby.test.tsx.
  const notice = (location.state as { notice?: string } | null)?.notice

  // CYJ-17: real create-room through the room-authority Edge Function. The
  // backend is live, so the flag gate is retired (same rollout as CYJ-16) —
  // this path is unconditional.
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // CYJ-23: the "Your active room" section. Tri-state (rule 12): undefined =
  // still resolving (the fetch chains off the session read) — the section
  // renders nothing rather than a false "No active room" flicker; null =
  // the server affirmatively returned no active room; a failed read is
  // surfaced as activeRoomError, never as an empty state.
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null | undefined>(undefined)
  const [activeRoomError, setActiveRoomError] = useState<string | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  // Dismissing the modal clears any leftover error so a stale forbidden/500
  // message never survives into the next open.
  const dismissCloseModal = () => {
    setCloseError(null)
    setCloseOpen(false)
  }
  const submitClose = async () => {
    if (!activeRoom || closing) return
    setClosing(true)
    setCloseError(null)
    try {
      const result = await closeRoom(activeRoom.roomId)
      if (result.kind === 'ok') {
        // AC #5: the closed room leaves the section (empty state). The row is
        // kept server-side with status 'closed'; the owner can now create a
        // new room since closed rows don't hit the one-active index.
        setCloseOpen(false)
        setActiveRoom(null)
      } else if (result.kind === 'unauthorized') {
        setCloseError('Please sign in to manage rooms.')
      } else if (result.kind === 'forbidden') {
        setCloseError('You are not the owner of this room.')
      } else {
        setCloseError(result.message)
      }
    } finally {
      setClosing(false)
    }
  }
  const submitCreate = async (settings: RoomSettingsValues) => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createRoom(settings)
      if (result.kind === 'ok') {
        setCreateOpen(false)
        navigate(`/room/${result.roomId}`)
      } else if (result.kind === 'unauthorized') {
        // AC #4: visible sign-in error, no navigation.
        setCreateError('Please sign in to create a room.')
      } else {
        setCreateError(result.message)
      }
    } finally {
      setCreating(false)
    }
  }

  // CYJ-31: real join-by-code. The modal stays open on failure so CodeInput
  // stays mounted and the typed code is preserved automatically (AC #2); the
  // `joining` guard prevents double-submits (CodeInput auto-submits on the 6th
  // char and has no disabled prop).
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const submitJoin = async (code: string) => {
    if (joining) return
    setJoining(true)
    setJoinError(null)
    try {
      const result = await fetchRoomIdByCode(code)
      if (result.kind === 'ok') {
        setJoinOpen(false)
        navigate(`/room/${result.roomId}`)
      } else if (result.kind === 'not-found') {
        setJoinError('No room found for that code.')
      } else {
        setJoinError(result.message)
      }
    } finally {
      setJoining(false)
    }
  }

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
          <Link to="/profile" className="lobby-avatar-link" aria-label={`Profile of ${displayName}`}>
            {authUser?.avatar_url ? (
              <img className="lobby-avatar-img" src={authUser.avatar_url} alt="" width={40} height={40} />
            ) : (
              <PlayerAvatar name={displayName} colorVar="var(--player-4)" size={40} />
            )}
            <span className="lobby-presence" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {notice && (
        <p className="lobby-notice" role="status">
          {notice}
        </p>
      )}

      <div className="lobby-columns">
        <section className="lobby-actions" aria-label="Actions">
          <p className="lobby-greeting">
            Hi, {displayName}! Ready to chain?
            {/* Signed-in users get a real name; pairing it with the fixture
                streak would show fabricated data, so the streak is mock-only. */}
            {!authUser && ` 🔥 streak: ${PROFILE.streak}`}
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

        {/* CYJ-23: the signed-in user's own active room — code, enter, close.
            Hidden entirely when signed out (the endpoint requires a session);
            an explicit empty state when signed in with no active room.
            CYJ-24: the section swapped positions with Friends' rooms (pure
            layout — no content change). */}
        {authUser && (
          <section className="lobby-active" aria-labelledby="lobby-active-heading">
            <h2 id="lobby-active-heading" className="lobby-section-title">
              Your active room
            </h2>
            {activeRoom ? (
              <div className="card lobby-active-row">
                <div className="lobby-room-info">
                  <span className="lobby-room-name">{activeRoom.name ?? 'Untitled room'}</span>
                  <span className="lobby-room-meta">
                    <span className="chip">{activeRoom.code}</span>
                    <span className="chip">
                      {activeRoom.status === 'waiting' ? 'waiting' : 'in progress'}
                    </span>
                  </span>
                </div>
                <div className="lobby-active-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate(`/room/${activeRoom.roomId}`)}
                  >
                    Enter
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setCloseError(null)
                      setCloseOpen(true)
                    }}
                  >
                    Close room
                  </button>
                </div>
              </div>
            ) : activeRoomError ? (
              <p className="lobby-active-empty" role="alert">
                {activeRoomError}
              </p>
            ) : activeRoom === undefined ? null : (
              <p className="lobby-active-empty">No active room</p>
            )}
            {/* closeError renders only inside the confirm modal — rendering it
                here too would double the role="alert" while the modal is open. */}
          </section>
        )}

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
                    {ordinal(g.placement)} · {g.playerCount} players
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
        {createError && (
          <p className="lobby-create-error" role="alert">
            {createError}
          </p>
        )}
        <RoomSettings
          submitLabel={creating ? 'Creating…' : 'Create Room'}
          onSubmit={submitCreate}
          defaultName={defaultRoomName(authUser?.display_name)}
        />
      </Modal>

      {/* S4 — Join with Code modal */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join with Code">
        {joinError && (
          <p className="lobby-create-error" role="alert">
            {joinError}
          </p>
        )}
        <CodeInput label="Room code" onComplete={submitJoin} />
        <p className="lobby-join-hint">or open an invite link</p>
      </Modal>

      {/* CYJ-23 — Close room confirm */}
      <Modal open={closeOpen} onClose={dismissCloseModal} title="Close room?">
        <p className="lobby-close-confirm">
          Closing this room ends it for everyone. The room code will stop working.
        </p>
        {closeError && (
          <p className="lobby-create-error" role="alert">
            {closeError}
          </p>
        )}
        <div className="lobby-secondary">
          <button type="button" className="btn btn-outline" onClick={dismissCloseModal}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={closing} onClick={submitClose}>
            {closing ? 'Closing…' : 'Close room'}
          </button>
        </div>
      </Modal>
    </main>
  )
}
