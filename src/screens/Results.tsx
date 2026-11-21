import { Link, useNavigate } from 'react-router-dom'
import { IdiomTile } from '../ui/IdiomTile'
import { PlayerAvatar } from '../ui/PlayerAvatar'
import { BEST_PLAY, RESULT_CHAINS, ROOM, STANDINGS } from '../mock/data'
import './Results.css'

/** S7 — Round Results / Game Over. */
export default function Results() {
  const navigate = useNavigate()
  const [winner, ...rest] = STANDINGS

  return (
    <main className="results">
      <h1 className="results-title">🏆 GAME OVER</h1>

      <section className="results-podium" aria-label="Winner">
        <div className="results-winner card">
          <PlayerAvatar name={winner.name} colorVar={winner.colorVar} size={72} ariaHidden={false} />
          <span className="results-winner-name">{winner.name}</span>
          <span className="results-winner-score">{winner.score}</span>
        </div>
        <div className="results-runners">
          {rest.slice(0, 2).map((s, i) => (
            <span key={s.name} className="results-runner">
              {i === 0 ? '🥈' : '🥉'} {s.name} {s.score}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="results-standings-heading">
        <h2 id="results-standings-heading" className="results-section-title">
          Full standings
        </h2>
        <ol className="results-standings">
          {STANDINGS.map((s, i) => (
            <li key={s.name}>
              <details className="card results-row">
                <summary>
                  <span className="results-rank">{i + 1}</span>
                  <span
                    className="results-row-name"
                    style={{ color: s.colorVar }}
                  >
                    {s.name}
                  </span>
                  <span className="results-row-score">{s.score}</span>
                  <span className="results-row-idioms">{s.idioms} idioms</span>
                </summary>
                <div className="results-row-chain">
                  {(RESULT_CHAINS[s.name] ?? []).map((idiom) => (
                    <IdiomTile key={idiom} text={idiom} size="results" />
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>

      <p className="results-best card">
        ⭐ Best play: 「{BEST_PLAY.idiom}」 +{BEST_PLAY.points} by {BEST_PLAY.by}
      </p>

      <button
        type="button"
        className="btn btn-primary btn-lg"
        onClick={() => navigate(`/room/${ROOM.id}`)}
      >
        🔁 Play Again
      </button>
      <Link to="/lobby" className="btn btn-text">
        Leave to Lobby
      </Link>
    </main>
  )
}
