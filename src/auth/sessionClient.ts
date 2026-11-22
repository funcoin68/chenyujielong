/**
 * Client-side session lookup for the CYJ-7 OAuth flow (CYJ-8). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { FUNCTIONS_URL } from '../config'

export interface AuthUser {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

/**
 * Resolve the session cookie (httpOnly, set by the auth Edge Function) to the
 * signed-in user. Any failure — no session, expired, network down — resolves
 * to null so callers fall back to the mock identity. Failures that mean
 * broken auth infrastructure (network throw, malformed 200) also warn, so
 * with flag-cyj-7 on "auth broken" is distinguishable from "not signed in"
 * (rule 12); a plain 401 stays quiet — it is the normal signed-out path.
 *
 * The "auth configured?" guard lives HERE (one home): a caller that forgets
 * it would otherwise fetch `<undefined>/auth/me` and fail silently (rule 12).
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!FUNCTIONS_URL) return null
  try {
    const res = await fetch(`${FUNCTIONS_URL}/auth/me`, { credentials: 'include' })
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
