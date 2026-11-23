/**
 * Durable client-side storage for the OAuth anti-CSRF state nonce (CYJ-14).
 * The cyj_oauth_state cookie is set from a cross-site fetch response and read
 * on a cross-site navigation, so browsers blocking third-party cookies lose
 * it — localStorage survives because the callback now lands on the APP origin
 * (/auth/callback). Client-only: deliberately NOT in src/lib/, which is
 * shared verbatim with the Deno Edge Function (onboarding pack §6).
 *
 * Defense-in-depth note: unlike the old HttpOnly cookie, localStorage is
 * readable by any same-origin script — a future XSS on the app origin could
 * harvest in-flight nonces. Accepted tradeoff for surviving third-party-
 * cookie blocking (CYJ-14); recorded here so the regression is explicit.
 */

export const OAUTH_STATE_KEY = 'cyj_oauth_state'

export function saveOauthState(state: string): void {
  localStorage.setItem(OAUTH_STATE_KEY, state)
}

/** Read-and-clear: single-use (AC #4) — cleared on every validation attempt. */
export function takeOauthState(): string | null {
  const state = localStorage.getItem(OAUTH_STATE_KEY)
  localStorage.removeItem(OAUTH_STATE_KEY)
  return state
}
