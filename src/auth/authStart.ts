/**
 * Auth-start client for the CYJ-7 OAuth flow (CYJ-10). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { SUPABASE_ANON_KEY } from '../config'

/**
 * Build the /auth/google/start URL. The preview flags ride as a query param
 * so the function can embed them in the OAuth state (CYJ-8). The anon key is
 * NOT in the URL — the gateway rejects a query-param apikey with
 * 401 UNAUTHORIZED_NO_AUTH_HEADER (verified against the live project, CYJ-10);
 * it travels in the apikey header on the fetch below.
 */
export function buildAuthStartUrl(functionsUrl: string, flags: string | null): string {
  const params = new URLSearchParams()
  if (flags) params.set('flags', flags)
  const query = params.toString()
  return `${functionsUrl}/auth/google/start${query ? `?${query}` : ''}`
}

/**
 * Start Google sign-in programmatically (CYJ-10). A top-level navigation
 * cannot set the apikey header the gateway requires, and a cross-origin fetch
 * cannot consume a 302 (follow = CORS failure, manual = unreadable Location),
 * so the Edge Function returns the Google authorize URL in its body and the
 * caller navigates to it. credentials: 'include' lets the anti-CSRF state
 * cookie be set from this cross-site response. Throws loudly on any failure —
 * the caller surfaces an error rather than navigating nowhere (rule 12).
 */
export async function startGoogleSignIn(
  functionsUrl: string,
  flags: string | null,
): Promise<string> {
  const res = await fetch(buildAuthStartUrl(functionsUrl, flags), {
    headers: { apikey: SUPABASE_ANON_KEY },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`auth start failed: HTTP ${res.status}`)
  const redirect: unknown = (await res.json())?.redirect
  // The result drives a top-level navigation — same https:-only discipline as
  // httpsUrlOrNull in src/auth/sessionClient.ts (never javascript:/data:).
  if (typeof redirect !== 'string' || !isHttpsUrl(redirect)) {
    throw new Error('auth start returned no https redirect')
  }
  return redirect
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Top-level navigation seam. jsdom's window.location.assign is
 * non-configurable, so tests intercept this instead of spying on the DOM API.
 */
export function navigateTo(url: string): void {
  window.location.assign(url)
}
