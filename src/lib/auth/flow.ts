/**
 * Pure decision layer for the Google OAuth flow (CYJ-7). Maps every callback
 * branch to a response decision; the Edge Function only executes it (fetch
 * Google, persist via PostgREST, build the HTTP response). No I/O here except
 * token generation/hashing, so Vitest covers every acceptance branch.
 */

import type { GoogleClaims } from './googleIdToken.ts'
import {
  clearStateCookie,
  generateSessionToken,
  hashSessionToken,
  randomUrlSafeToken,
  serializeSessionCookie,
  sessionExpiresAt,
} from './session.ts'

export function buildAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Anti-CSRF state for the OAuth round-trip (128-bit is plenty). */
export function generateState(): string {
  return randomUrlSafeToken(16)
}

/**
 * Flag persistence: the OAuth round-trip strips the app's query string, so
 * preview flags (pack §4) ride inside the anti-CSRF state as
 * `<random>.<uri-encoded-flags>` — base64url randomness never contains '.',
 * the state cookie holds the composite verbatim, Google echoes it back, and
 * the callback re-attaches the flags to its redirect.
 */
export function encodeStateWithFlags(state: string, flags: string | null): string {
  return flags ? `${state}.${encodeURIComponent(flags)}` : state
}

export function flagsFromState(state: string | null): string | null {
  if (!state) return null
  const dot = state.indexOf('.')
  if (dot < 0) return null
  const encoded = state.slice(dot + 1)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

export interface UserUpsert {
  email: string
  display_name: string | null
  avatar_url: string | null
  auth_provider: 'google'
  password_hash: null
}

export interface SessionToStore {
  tokenHash: string
  expiresAt: Date
}

export interface CallbackDecision {
  status: 302 | 401
  redirect?: string
  error?: string
  setCookies: string[]
  userUpsert?: UserUpsert
  session?: SessionToStore
}

export interface CallbackInput {
  query: URLSearchParams
  stateCookie: string | undefined
  /**
   * CYJ-14: the client-verified state from durable client storage
   * (localStorage), sent as the `stored` query param when the browser
   * blocked the third-party state cookie. Cookie-first when both arrive.
   */
  storedState?: string
  /** Verified ID-token claims, or null when verification failed. */
  claims: GoogleClaims | null
  appBaseUrl: string
}

export async function handleCallback(input: CallbackInput): Promise<CallbackDecision> {
  const base = input.appBaseUrl.replace(/\/+$/, '')

  // Flags carried through the state (see encodeStateWithFlags) are echoed
  // into every redirect so flag-gated behavior survives the round-trip.
  const flags = flagsFromState(input.query.get('state'))
  const appUrl = (path: string, extraQuery?: string): string => {
    const qs = [extraQuery, flags ? `flags=${encodeURIComponent(flags)}` : '']
      .filter(Boolean)
      .join('&')
    return `${base}${path}${qs ? `?${qs}` : ''}`
  }

  // AC #4: Google sent an error (e.g. access_denied) — bounce back to the
  // login page with an indicator, never a session.
  const error = input.query.get('error')
  if (error) {
    return {
      status: 302,
      redirect: appUrl('/', `auth_error=${encodeURIComponent(error)}`),
      setCookies: [clearStateCookie()],
    }
  }

  // Anti-CSRF: the state Google echoed must match the cookie we set at start,
  // or — when third-party cookies blocked that cookie — the client-verified
  // value from durable client storage (CYJ-14). The cookie wins when both
  // arrive, so cookie-present behavior is unchanged.
  // CYJ-8 AC #5: failures bounce back to the app with a visible error — never
  // a raw 401 JSON page the user can't recover from.
  const state = input.query.get('state')
  const expected = input.stateCookie ?? input.storedState
  if (!state || !expected || state !== expected) {
    return {
      status: 302,
      redirect: appUrl('/', 'auth_error=state_mismatch'),
      setCookies: [clearStateCookie()],
    }
  }

  // AC #3: invalid/expired signature, wrong audience, wrong issuer (or a
  // token without an email to key the user row on) — no session cookie.
  const { claims } = input
  if (!claims || !claims.email) {
    return {
      status: 302,
      redirect: appUrl('/', 'auth_error=invalid_token'),
      setCookies: [clearStateCookie()],
    }
  }

  // AC #1/#2: upsert keyed on email (PostgREST merge-duplicates reuses an
  // existing row, so returning users are not re-inserted) and issue a session.
  const token = generateSessionToken()
  return {
    status: 302,
    redirect: appUrl('/lobby'),
    setCookies: [serializeSessionCookie(token), clearStateCookie()],
    userUpsert: {
      email: claims.email,
      display_name: claims.name ?? null,
      avatar_url: claims.picture ?? null,
      auth_provider: 'google',
      password_hash: null,
    },
    session: { tokenHash: await hashSessionToken(token), expiresAt: sessionExpiresAt() },
  }
}
