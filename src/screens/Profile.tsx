import { Link, useNavigate } from 'react-router-dom'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { PROFILE } from '../mock/data'
import { signOutClient } from '../auth/sessionClient'
import './Profile.css'

const MEDALS = ['🥇', '🥈', '🥉']
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)

/** S8 — Profile & Stats. */
export default function Profile() {
  const navigate = useNavigate()
  const { stats } = PROFILE

  return (
    <main className="profile">
      <header className="profile-topbar">
        <Link to="/lobby" className="btn btn-text">
          ← Lobby
        </Link>
        <h1 className="profile-heading">Profile</h1>
        <span className="profile-topbar-spacer" aria-hidden="true" />
      </header>

      <section className="card profile-identity" aria-label="Identity">
        <PlayerAvatar name={PROFILE.name} colorVar="var(--player-4)" size={64} ariaHidden={false} />
        <div>
          <p className="profile-name">{PROFILE.name}</p>
          <p className="profile-meta">{PROFILE.email}</p>
          <p className="profile-meta">Member since {PROFILE.memberSince}</p>
        </div>
      </section>

      <section aria-labelledby="profile-stats-heading">
        <h2 id="profile-stats-heading" className="profile-section-title">
          Stats
        </h2>
        <div className="profile-stats">
          <div className="card profile-stat">
            <span className="profile-stat-value">{stats.gamesPlayed}</span>
            <span className="profile-stat-label">Games played</span>
          </div>
          <div className="card profile-stat">
            <span className="profile-stat-value">{stats.winRate}</span>
            <span className="profile-stat-label">Win rate</span>
          </div>
          <div className="card profile-stat">
            <span className="profile-stat-value">{stats.longestChain}</span>
            <span className="profile-stat-label">Longest chain</span>
          </div>
          <div className="card profile-stat">
            <span className="profile-stat-value profile-stat-idiom">{stats.favoriteIdiom}</span>
            <span className="profile-stat-label">Favorite idiom</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="profile-history-heading">
        <h2 id="profile-history-heading" className="profile-section-title">
          History
        </h2>
        <ul className="profile-history">
          {PROFILE.history.map((g) => (
            <li key={g.date} className="card profile-history-row">
              <span aria-hidden="true">{MEDALS[g.placement - 1] ?? `#${g.placement}`}</span>
              <span>
                {ordinal(g.placement)} of {g.playerCount}
              </span>
              <span className="profile-history-date">{g.date}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="profile-settings-heading">
        <h2 id="profile-settings-heading" className="profile-section-title">
          Settings
        </h2>
        <div className="card profile-settings">
          <label className="profile-setting">
            <input type="checkbox" defaultChecked /> Sound
          </label>
          <label className="profile-setting">
            <input type="checkbox" defaultChecked /> Vibration
          </label>
          <label className="profile-setting">
            <input type="checkbox" defaultChecked /> Suggestion chips
          </label>
          <label className="profile-setting">
            Language{' '}
            <select defaultValue="zh" aria-label="Language">
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </section>

      {/* Mock tier: no server-side revoke endpoint exists — sign-out clears
          the client session (stored token + cached /me lookup, CYJ-26) so the
          next navigation re-resolves from scratch, then returns to Landing. */}
      <button
        type="button"
        className="btn btn-text profile-signout"
        onClick={() => {
          signOutClient()
          navigate('/')
        }}
      >
        Sign out
      </button>
    </main>
  )
}
