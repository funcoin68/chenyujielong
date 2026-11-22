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
 * to null so callers fall back to the mock identity.
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/auth/me`, { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body?.user ?? null
  } catch {
    return null
  }
}
