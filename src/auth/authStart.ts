/**
 * Auth-start URL builder for the CYJ-7 OAuth flow (CYJ-9). Client-only:
 * deliberately NOT in src/lib/, which is shared verbatim with the Deno Edge
 * Function (onboarding pack §6).
 */
import { SUPABASE_ANON_KEY } from '../config'

/**
 * Build the /auth/google/start URL. A browser navigation cannot set headers,
 * so the publishable anon key rides as the `apikey` query param — the gateway
 * accepts it there — fixing the 401 "No API key found in request". The key is
 * public by design (already inlined into the bundle); omitted entirely when
 * not configured rather than left as a dangling `apikey=`.
 */
export function buildAuthStartUrl(functionsUrl: string, flags: string | null): string {
  const params = new URLSearchParams()
  if (flags) params.set('flags', flags)
  if (SUPABASE_ANON_KEY) params.set('apikey', SUPABASE_ANON_KEY)
  const query = params.toString()
  return `${functionsUrl}/auth/google/start${query ? `?${query}` : ''}`
}
