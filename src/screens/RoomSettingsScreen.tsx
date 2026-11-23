import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { RoomSettings, type RoomSettingsValues } from './RoomSettings'
import { fetchCurrentUser, type AuthUser } from '../auth/sessionClient'
import { fetchRoom, updateRoom, type FetchRoomResult } from '../rooms/roomClient'
import './RoomSettingsScreen.css'

/** CYJ-28 — S5 settings: real, route-backed, fed by ONE GET to room-authority
 *  room/:id. The host sees editable fields and a working Save (persisted via
 *  the host-only update-room path, 403 for non-hosts server-side); everyone
 *  else — and signed-out visitors — sees the same fields read-only with no
 *  save. A failed GET redirects to /lobby with a visible notice; a failed
 *  save shows a visible error and keeps the user's edits. No fixture fallback
 *  exists on any path. */
export default function RoomSettingsScreen() {
  const navigate = useNavigate()
  const { roomId = '' } = useParams()
  // Tri-state (WaitingRoom's CYJ-24 pattern): undefined = still resolving —
  // the loading branch renders NO room data, so fixture values can never leak
  // while the fetch is in flight.
  const [result, setResult] = useState<FetchRoomResult | undefined>(undefined)
  // Host-vs-guest needs the caller's id; resolved best-effort — a failed
  // /auth/me just means read-only (AC #3: non-hosts and visitors read-only).
  const [me, setMe] = useState<AuthUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // AC #2: a failed read redirects to the lobby with a visible notice — the
  // same hand-off mechanism the settings screen itself uses for save errors.
  useEffect(() => {
    if (result && result.kind !== 'ok') {
      navigate('/lobby', {
        replace: true,
        state: { notice: result.kind === 'not-found' ? 'Room not found.' : result.message },
      })
    }
  }, [result, navigate])

  if (result === undefined || result.kind !== 'ok') {
    return (
      <main className="settings-screen">
        <p>Loading settings…</p>
      </main>
    )
  }

  const { room, players } = result
  const isHost = me !== null && players.some((p) => p.isHost && p.userId === me.id)

  const handleSubmit = async (settings: RoomSettingsValues) => {
    if (saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await updateRoom(roomId, settings)
      if (res.kind === 'ok') {
        // The form's internal state already holds the saved values — the
        // parent never remounts or overwrites it (AC #4).
        setNotice('Settings saved.')
      } else if (res.kind === 'unauthorized') {
        setError('Please sign in to save settings.')
      } else if (res.kind === 'forbidden') {
        setError('Only the room host can change settings.')
      } else {
        // AC #5: visible failure, and the form state is untouched — no edit
        // is lost (rule 12: fail visibly, not silently).
        setError(res.message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="settings-screen">
      <header className="settings-screen-topbar">
        <Link to={`/room/${roomId}`} className="btn btn-text">
          ← Back
        </Link>
        <h1 className="settings-screen-title">Room settings</h1>
      </header>

      {notice && (
        <p className="settings-screen-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="settings-screen-error" role="alert">
          {error}
        </p>
      )}

      <RoomSettings
        submitLabel={saving ? 'Saving…' : 'Save Settings'}
        onSubmit={handleSubmit}
        initialValues={{
          name: room.name ?? '',
          rule: room.rule,
          turnSeconds: room.turnSeconds,
          maxPlayers: room.maxPlayers,
          winCondition: room.winCondition,
          dictionary: room.dictionary,
        }}
        editable={isHost}
      />
    </main>
  )
}
