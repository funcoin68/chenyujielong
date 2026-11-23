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

/**
 * Resolve the stored session token to the signed-in user. CYJ-15: the client
 * attaches the raw token as the x-cyj-session header because the HttpOnly
 * cyj_session cookie lives on the functions domain and browsers blocking
 * third-party cookies never send it on this cross-site fetch — the header
 * travels regardless (the cookie is kept as defense-in-depth for browsers
 * that allow it; the Edge Function prefers the cookie when both arrive).
 * The anon key rides in the apikey header per the CYJ-10 transport pattern
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
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!FUNCTIONS_URL) return null
  const token = readSessionToken()
  try {
    const res = await fetch(`${FUNCTIONS_URL}/auth/me`, {
      credentials: 'include',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        ...(token ? { 'x-cyj-session': token } : {}),
      },
    })
    if (res.status === 401) clearSessionToken()
    if (!res.ok) return null
    const body = await res.json()
    const user = body?.user
    if (!user) {
      console.warn('fetchCurrentUser: 200 response without a user payload')
      return null
    }
    return { ...user, avatar_url: httpsUrlOrNull(user.avatar_url) }
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
