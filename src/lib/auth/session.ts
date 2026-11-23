/**
 * Opaque server-side sessions (CYJ-7). The raw token lives only in the
 * httpOnly cookie; the database stores its SHA-256 hash, so a database leak
 * does not leak usable sessions. Transport-free so Vitest and the Deno Edge
 * Function share it verbatim (imported with explicit .ts extensions).
 */

export const SESSION_COOKIE = 'cyj_session'
export const STATE_COOKIE = 'cyj_oauth_state'
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60 // 14 days
export const STATE_MAX_AGE_SECONDS = 10 * 60 // OAuth round-trip TTL

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomUrlSafeToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return b64urlEncode(bytes)
}

/** 256-bit random session token, base64url (cookie/header safe). */
export function generateSessionToken(): string {
  return randomUrlSafeToken(32)
}

/** SHA-256 hex of the raw token — this is what the sessions table stores. */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function sessionExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime()
}

// The functions domain differs from the app domain, so the session cookie
// must be SameSite=None; Secure to survive the cross-site /auth/me fetch
// (known third-party-cookie limitation documented in the proposal).
export function serializeSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`
}

// The state cookie is set from the cross-site /auth/google/start fetch
// response (CYJ-10), so it needs SameSite=None; Secure to be stored at all;
// the top-level callback navigation then sends it (same third-party-cookie
// limitation class as the session cookie above).
export function serializeStateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${STATE_MAX_AGE_SECONDS}`
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

/**
 * CYJ-15: which credential authenticates /auth/me — the HttpOnly session
 * cookie when the browser sent it, else the x-cyj-session header the client
 * attaches (browsers blocking third-party cookies never send the cross-site
 * cookie). The cookie wins when both arrive (HttpOnly beats the
 * localStorage-readable header value). Null when neither is present, which
 * the Edge Function maps to 401 {"error":"no session"} — never a 500.
 */
export function resolveSessionToken(
  cookieHeader: string | null,
  headerToken: string | null,
): string | null {
  return parseCookies(cookieHeader)[SESSION_COOKIE] ?? headerToken
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name) out[name] = value
  }
  return out
}

export interface SessionIdentity {
  user_id: string
  expires_at: string
}

/**
 * CYJ-17 review (round 1): the one home for token -> user resolution. Both
 * Edge Functions (auth handleMe, room-authority) used to carry their own
 * copy of the token_hash -> sessions lookup, which would drift on
 * expiry/rotation semantics. Transport-free: the caller injects the lookup
 * (PostgREST in the Edge Functions, a stub in tests). Cookie-token first;
 * null when the cookie, the row, or the unexpired session is missing —
 * callers map null to their own 401 contract.
 */
export async function resolveUserId(
  cookieHeader: string | null,
  lookup: (tokenHash: string) => Promise<SessionIdentity | null>,
): Promise<string | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE]
  if (!token) return null
  const row = await lookup(await hashSessionToken(token))
  if (!row) return null
  if (isSessionExpired(new Date(row.expires_at))) return null
  return row.user_id
}
