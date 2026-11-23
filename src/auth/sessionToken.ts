/**
 * Durable client-side storage for the raw session token (CYJ-15). The sign-in
 * success redirect carries the token in the /lobby URL (flow.ts) because the
 * HttpOnly cyj_session cookie lives on the functions domain and browsers
 * blocking third-party cookies never send it on the cross-site /auth/me
 * fetch — localStorage survives. Client-only: deliberately NOT in src/lib/,
 * which is shared verbatim with the Deno Edge Function (onboarding pack §6).
 *
 * Defense-in-depth note: same tradeoff CYJ-14 accepted and documented for
 * the OAuth state nonce (see oauthState.ts) — unlike the HttpOnly cookie,
 * localStorage is readable by any same-origin script. Accepted so sign-in
 * survives third-party-cookie blocking; recorded here so the regression is
 * explicit. The HttpOnly cookie remains set as defense-in-depth for browsers
 * that allow it.
 */

export const SESSION_TOKEN_KEY = 'cyj_session_token'

export function saveSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token)
  } catch {
    // Storage denied (hardened browsers): degrade silently — every call site
    // treats a missing token as signed-out, and fetchCurrentUser still tries
    // the cookie path. Never throw from a storage helper (rule 12).
  }
}

export function readSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Storage denied: nothing to clear; see saveSessionToken.
  }
}
