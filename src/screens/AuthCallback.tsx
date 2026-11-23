import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FUNCTIONS_URL } from '../config'
import { navigateTo } from '../auth/authStart'
import { takeOauthState } from '../auth/oauthState'
import './AuthCallback.css'

/**
 * App-domain OAuth callback (CYJ-14). Google redirects here instead of the
 * Edge Function so the anti-CSRF state can be validated against durable
 * client storage (localStorage), which survives the third-party-cookie
 * blocking that broke the cross-site state cookie. On a match the browser
 * proceeds top-level to the function callback to complete sign-in; every
 * failure bounces back to the landing screen with the visible CYJ-8 error
 * banner source. Transient screen — mounts no real UI.
 */
export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    // Single-use (AC #4): cleared by the validation attempt itself, including
    // failures — retrying sign-in generates a fresh nonce at start.
    const stored = takeOauthState()
    const error = searchParams.get('error')
    const state = searchParams.get('state')
    const code = searchParams.get('code')

    if (error) {
      navigate(`/?auth_error=${encodeURIComponent(error)}`)
      return
    }
    // AC #3: missing or mismatched state — visible failure, no session.
    if (!state || !stored || state !== stored) {
      navigate('/?auth_error=state_mismatch')
      return
    }
    // State matched but Google sent no code — surface a specific error rather
    // than forwarding an empty code to the function (which would label this
    // invalid_token, conflating a malformed callback with a bad token).
    if (!code) {
      navigate('/?auth_error=missing_code')
      return
    }
    // AC #2: match — complete sign-in at the function callback. Cross-origin,
    // so the top-level navigation goes through navigateTo(), not useNavigate()
    // (react-router would treat the function URL as an internal route).
    const target = new URL(`${FUNCTIONS_URL}/auth/google/callback`)
    target.searchParams.set('code', code)
    target.searchParams.set('state', state)
    target.searchParams.set('stored', stored)
    navigateTo(target.toString())
  }, [searchParams, navigate])

  return (
    <main className="auth-callback">
      <p className="auth-callback-message">Completing sign-in…</p>
    </main>
  )
}
