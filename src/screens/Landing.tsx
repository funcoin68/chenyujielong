import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChainView } from '../ui/ChainView'
import { IdiomTile } from '../ui/IdiomTile'
import { Modal } from '../ui/Modal'
import { DEMO_CHAIN, PLAYERS_BY_ID, ROOM } from '../mock/data'
import { hasFlag } from '../flags'
import { FUNCTIONS_URL } from '../config'
import { navigateTo, startGoogleSignIn } from '../auth/authStart'
import { saveOauthState } from '../auth/oauthState'
import './Landing.css'

/** Google "G" mark (multicolor), per Google's brand asset guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5.1L1.3 17.2C3.3 21.2 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.3 6.8C.5 8.5 0 10.2 0 12s.5 3.5 1.3 5.2l3.9-2.9z"
      />
      <path
        fill="#EA4335"
        d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.9 2.9c.9-2.9 3.6-5 6.8-5z"
      />
    </svg>
  )
}

/** S1 — Landing / Sign-in. */
export default function Landing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [howToOpen, setHowToOpen] = useState(false)
  const [signInFailed, setSignInFailed] = useState(false)
  const signInRef = useRef<HTMLButtonElement>(null)
  // AC #4: the OAuth callback bounces failures back here as ?auth_error=…
  const authError = searchParams.get('auth_error')

  const onSignIn = async () => {
    // flag-cyj-7: real Google OAuth via the auth Edge Function. Flag off (or
    // functions URL not configured) keeps the mock navigate to the lobby.
    // The start endpoint is fetched programmatically (a navigation cannot set
    // the apikey header the gateway requires) and returns the Google
    // authorize URL to navigate to; the flags query rides along so the
    // function can embed it in the OAuth state for the trip back to /lobby.
    if (hasFlag('flag-cyj-7', searchParams) && FUNCTIONS_URL) {
      setSignInFailed(false)
      try {
        const redirect = await startGoogleSignIn(FUNCTIONS_URL, searchParams.get('flags'))
        // CYJ-14 AC #1: persist the OAuth state nonce to durable client
        // storage BEFORE leaving for Google. The cross-site state cookie is
        // blocked in some browsers; the /auth/callback route validates the
        // echoed state against this value instead. The redirect URL is
        // already https-validated inside startGoogleSignIn.
        const state = new URL(redirect).searchParams.get('state')
        if (state) saveOauthState(state)
        navigateTo(redirect)
      } catch (err) {
        console.warn('onSignIn: auth start failed', err)
        setSignInFailed(true)
      }
    } else {
      navigate('/lobby')
    }
  }

  return (
    <main className="landing">
      <div className="landing-column">
        <div className="landing-logo" aria-hidden="true">
          {['成', '语', '接', '龙'].map((ch, i) => (
            <span key={ch} className="landing-logo-step">
              {i > 0 && <span className="landing-logo-arrow">→</span>}
              <IdiomTile text={ch} size="slot" />
            </span>
          ))}
        </div>
        <h1 className="landing-wordmark">成语接龙</h1>
        <p className="landing-tagline">Chain idioms. Beat your friends.</p>

        {(authError || signInFailed) && (
          <p className="landing-auth-error" role="alert">
            Sign-in failed{authError ? ` (${authError})` : ''}. Please try again.
          </p>
        )}

        {/* flag-cyj-7: real Google OAuth; flag off keeps the mock lobby navigate */}
        <button ref={signInRef} type="button" className="btn btn-lg landing-google" onClick={onSignIn}>
          <GoogleMark />
          Sign in with Google
        </button>

        <button type="button" className="btn btn-text" onClick={() => setHowToOpen(true)}>
          How to play · 怎么玩
        </button>
        <Link className="btn btn-text landing-guest" to={`/room/${ROOM.id}/play`}>
          ── or peek as guest ──
        </Link>
      </div>

      {/* S1a — How to Play bottom sheet */}
      <Modal open={howToOpen} onClose={() => setHowToOpen(false)} title="How to play · 怎么玩">
        <ol className="landing-steps">
          <li>
            <strong>① See the last character.</strong> The chain ends with a character — that&apos;s
            your starting sound.
          </li>
          <li>
            <strong>② Type an idiom starting with it.</strong> Four characters, native IME or
            handwriting.
          </li>
          <li>
            <strong>③ Score points.</strong> Speed, rarity, and streaks all count.
          </li>
        </ol>
        <div className="landing-example">
          <ChainView entries={DEMO_CHAIN} playersById={PLAYERS_BY_ID} />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => {
            setHowToOpen(false)
            signInRef.current?.focus()
          }}
        >
          Got it — Sign in
        </button>
      </Modal>
    </main>
  )
}
