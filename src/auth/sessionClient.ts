/**
 * Client-side session lookup for the CYJ-7 OAuth flow (CYJ-8, CYJ-15).
 * Client-only: deliberately NOT in src/lib/, which is shared verbatim with
 * the Deno Edge Function (onboarding pack §6).
 */
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../config'
import { clearSessionToken, readSessionToken } from './sessionToken'

export interface AuthUser {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

/** CYJ-26: module-level session cache, keyed on the stored token so an OAuth
 * hand-off (token change) naturally misses. `user: null` entries are the
 * definitive signed-out state (only ever written by a 401), never a cached
 * transient failure. */
interface SessionCache {
  token: string | null
  user: AuthUser | null
}
let cached: SessionCache | null = null
// In-flight dedupe: concurrent mounts (Landing + Lobby pattern) share one
// promise, so the whole navigation sequence costs one GET /auth/me.
let inflight: Promise<AuthUser | null> | null = null

/** Test + sign-out hook: drop the cached session AND any in-flight request,
 * so a later caller never inherits a dangling promise (a test that stubbed
 * /auth/me with a never-settling response, or a sign-out racing a slow read).
 * Dropping the reference is safe: results are written token-keyed, so a
 * late-settling old request can only populate a cache entry that a token
 * clear/sign-out has already made unreachable. */
export function invalidateSessionCache(): void {
  cached = null
  inflight = null
}

/** CYJ-26: client-side sign-out — clear the stored token AND the cached /me
 * lookup so the next navigation re-resolves from scratch (AC #3). There is no
 * server-side revoke endpoint at the mock tier; clearing the client session
 * matches the current behavior. */
export function signOutClient(): void {
  clearSessionToken()
  invalidateSessionCache()
}

/**
 * Resolve the stored session token to the signed-in user. CYJ-15: the client
 * attaches the raw token as the x-cyj-session header because the HttpOnly
 * cyj_session cookie lives on the functions domain and browsers blocking
 * third-party cookies never send it on this cross-site fetch — the header
 * travels regardless (the cookie is kept as defense-in-depth for browsers
 * that allow it; the Edge Function prefers the cookie when both arrive).
 * The anon key rides in the apikey header per the CYJ-9 transport pattern
 * (the gateway rejects a query-param apikey).
 *
 * Any failure — no session, expired, network down — resolves to null so
 * callers fall back to the mock identity. Failures that mean broken auth
 * infrastructure (network throw, malformed 200) also warn, so with
 * flag-cyj-7 on "auth broken" is distinguishable from "not signed in"
 * (rule 12); a plain 401 stays quiet — it is the normal signed-out path —
 * but clears the stored token so a wrong/expired token never lingers.
 *
 * The "auth configured?" guard lives HERE (one home): a caller that forgets
 * it would otherwise fetch `<undefined>/auth/me` and fail silently (rule 12).
 *
 * CYJ-26: sequential navigations reuse the token-keyed cache (one /me request
 * per session, not one per screen mount); concurrent mounts share the
 * in-flight promise. Caching rules (failures are never cached as success):
 * a 200 with a user caches it; a 401 caches the definitive signed-out state
 * (and clears the stored token, as before); network throws, non-ok non-401s
 * and malformed 200s cache nothing — the next call retries so transient
 * failures stay visible (rule 12).
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!FUNCTIONS_URL) return null
  const token = readSessionToken()
  if (inflight) return inflight
  if (cached && cached.token === token) return cached.user
  const promise = requestCurrentUser(token)
  // Track a finally-wrapped copy for clearing, but hand callers the raw
  // promise: requestCurrentUser never rejects, and this keeps the caller-
  // visible resolution timing identical to the pre-cache implementation
  // (screen-test act() flushes sit exactly at the microtask boundary). The
  // identity guard stops a late-settling OLD request (dropped from `inflight`
  // by invalidateSessionCache) from nulling out a NEWER in-flight request.
  const tracked = promise.finally(() => {
    if (inflight === tracked) inflight = null
  })
  inflight = tracked
  return promise
}

async function requestCurrentUser(token: string | null): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/auth/me`, {
      credentials: 'include',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        ...(token ? { 'x-cyj-session': token } : {}),
      },
    })
    if (res.status === 401) {
      clearSessionToken()
      // The 401 is the definitive signed-out state, not a transient failure:
      // cache it so re-navigating while signed out doesn't refetch. Safe even
      // though the token was just cleared — the key mismatch on the next read
      // simply falls through to one clean signed-out fetch.
      cached = { token, user: null }
      return null
    }
    if (!res.ok) return null
    const body = await res.json()
    const user = body?.user
    if (!user) {
      console.warn('fetchCurrentUser: 200 response without a user payload')
      return null
    }
    const authUser = { ...user, avatar_url: httpsUrlOrNull(user.avatar_url) }
    cached = { token, user: authUser }
    return authUser
  } catch (err) {
    console.warn('fetchCurrentUser: session fetch failed', err)
    return null
  }
}

/**
 * Avatar URLs originate from Google ID-token claims via the auth Edge
 * Function (Google hosts them on *.googleusercontent.com over https). Accept
 * only https: URLs so a weakened server path can never push an arbitrary
 * scheme (javascript:, data:) into <img src>.
 */
function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}
