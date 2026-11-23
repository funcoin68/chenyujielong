// auth: Google OAuth sign-in (CYJ-7).
// Transport only — decision logic lives in src/lib/auth/ (see
// supabase/functions/README.md): this file owns env checks, Google/PostgREST
// fetches, and HTTP responses; src/lib/auth/ owns every branch decision.
import { verifyGoogleIdToken } from '../../../src/lib/auth/googleIdToken.ts'
import { buildAuthorizeUrl, encodeStateWithFlags, generateState, handleCallback } from '../../../src/lib/auth/flow.ts'
import type { UserUpsert } from '../../../src/lib/auth/flow.ts'
import {
  STATE_COOKIE,
  clearSessionCookie,
  hashSessionToken,
  isSessionExpired,
  parseCookies,
  resolveSessionToken,
  serializeStateCookie,
} from '../../../src/lib/auth/session.ts'

// AC #6: missing config must be a loud cold-start error, not a silent 500.
const REQUIRED_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APP_BASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]
const missingEnv = REQUIRED_ENV.filter((name) => !Deno.env.get(name))
if (missingEnv.length > 0) {
  console.error(
    `FATAL auth: missing env vars: ${missingEnv.join(', ')} — set them in Supabase project secrets`,
  )
}
const configured = missingEnv.length === 0

const CONFIG = {
  clientId: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
  clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
  appBaseUrl: (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/+$/, ''),
  supabaseUrl: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
}
// CYJ-14: the OAuth redirect lands on the APP domain (/auth/callback route)
// instead of this function — the app validates the anti-CSRF state against
// durable client storage (localStorage), which survives the third-party-
// cookie blocking that broke the cross-site cyj_oauth_state cookie. Both the
// authorize URL and the code→token exchange use this one constant, so a
// single Google-console redirect-URI edit covers both hops. The old
// functions-domain URI stays registered there as the rollback path.
const REDIRECT_URI = `${CONFIG.appBaseUrl}/auth/callback`

// Google's signing keys, cached per isolate (Google rotates ~daily).
let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null
async function fetchJwks(): Promise<{ keys: JsonWebKey[] }> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000) return jwksCache
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs')
  if (!res.ok) throw new Error(`google jwks fetch failed: HTTP ${res.status}`)
  const body = await res.json()
  jwksCache = { keys: body.keys, fetchedAt: Date.now() }
  return jwksCache
}

async function exchangeCodeForIdToken(code: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    console.error(`auth: google token exchange failed: HTTP ${res.status}`)
    return null
  }
  return (await res.json()).id_token ?? null
}

// PostgREST via the service role — RLS is enabled with no policies, so ONLY
// this function can touch users/sessions; the key never leaves the server.
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${CONFIG.supabaseUrl}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: CONFIG.serviceRoleKey,
      Authorization: `Bearer ${CONFIG.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

// Upsert keyed on email: inserts a new google user (AC #2) or reuses the
// existing row (AC #1 — merge-duplicates, never a duplicate insert).
async function upsertUser(row: UserUpsert): Promise<string | null> {
  const res = await rest('/users?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    console.error(`auth: user upsert failed: HTTP ${res.status} ${await res.text()}`)
    return null
  }
  const rows = await res.json()
  return rows?.[0]?.id ?? null
}

function withCors(headers: Headers): Headers {
  headers.set('Access-Control-Allow-Origin', CONFIG.appBaseUrl)
  headers.set('Access-Control-Allow-Credentials', 'true')
  return headers
}

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}

async function handleStart(req: Request): Promise<Response> {
  // Preview flags ride inside the state so they survive the Google round-trip
  // and land back on the app via the callback redirect (CYJ-8 AC #4 fix).
  const flags = new URL(req.url).searchParams.get('flags')
  const state = encodeStateWithFlags(generateState(), flags)
  const headers = withCors(new Headers())
  headers.append('Set-Cookie', serializeStateCookie(state))
  // CYJ-10: the client fetches this endpoint (a top-level navigation cannot
  // set the apikey header the gateway requires), and a cross-origin fetch
  // cannot consume a 302 — hand the authorize URL back in a CORS-readable
  // body and let the client drive the navigation to Google.
  return json(
    { redirect: buildAuthorizeUrl({ clientId: CONFIG.clientId, redirectUri: REDIRECT_URI, state }) },
    200,
    headers,
  )
}

async function handleGoogleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const cookies = parseCookies(req.headers.get('cookie'))

  // Verify the ID token only when the callback is well-formed; every failure
  // mode funnels into handleCallback, which maps it per the AC branches.
  // CYJ-14: pre-validate state against the cookie OR the client-supplied
  // `stored` value BEFORE the outbound Google exchange — a request whose
  // state cannot match either channel dies without burning a Google API call
  // or an authorization code. handleCallback still does the authoritative
  // branch mapping.
  let claims = null
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const storedParam = url.searchParams.get('stored') ?? undefined
  const stateCookie = cookies[STATE_COOKIE]
  const stateWouldMatch =
    !!stateParam && (stateParam === stateCookie || stateParam === storedParam)
  if (!url.searchParams.get('error') && code && stateWouldMatch) {
    const idToken = await exchangeCodeForIdToken(code)
    if (idToken) {
      try {
        const jwks = await fetchJwks()
        claims = await verifyGoogleIdToken(idToken, jwks, CONFIG.clientId)
      } catch (err) {
        console.error(`auth: id token verification error: ${err}`)
      }
    }
  }

  const decision = await handleCallback({
    query: url.searchParams,
    stateCookie,
    storedState: storedParam,
    claims,
    appBaseUrl: CONFIG.appBaseUrl,
  })

  const headers = withCors(new Headers())
  for (const cookie of decision.setCookies) headers.append('Set-Cookie', cookie)

  if (decision.status !== 302 || !decision.redirect) {
    return json({ error: decision.error ?? 'unauthorized' }, decision.status, headers)
  }

  // Success branch: persist user + session BEFORE issuing the cookie —
  // fail visibly (500, no cookie) rather than set an unusable session.
  if (decision.userUpsert && decision.session) {
    const userId = await upsertUser(decision.userUpsert)
    if (!userId) return json({ error: 'sign-in failed' }, 500, withCors(new Headers()))
    const sessionRes = await rest('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        token_hash: decision.session.tokenHash,
        expires_at: decision.session.expiresAt.toISOString(),
      }),
    })
    if (!sessionRes.ok) {
      console.error(`auth: session insert failed: HTTP ${sessionRes.status} ${await sessionRes.text()}`)
      return json({ error: 'sign-in failed' }, 500, withCors(new Headers()))
    }
  }

  headers.set('Location', decision.redirect)
  return new Response(null, { status: 302, headers })
}

// AC #5: resolve the session cookie to the user it belongs to.
// CYJ-15: cookie-first, then the x-cyj-session header — browsers blocking
// third-party cookies never send the cross-site cyj_session cookie, so the
// client (which received the raw token on the success redirect, stored it,
// and attaches it as this header) is the channel that works everywhere. The
// cookie wins when both arrive (it is HttpOnly; the header value comes from
// localStorage, which any same-origin script can read). The 401 contract
// below is unchanged: no token → {"error":"no session"}, never a 500.
async function handleMe(req: Request): Promise<Response> {
  const headers = withCors(new Headers())
  const token = resolveSessionToken(req.headers.get('cookie'), req.headers.get('x-cyj-session'))
  if (!token) return json({ error: 'no session' }, 401, headers)

  const tokenHash = await hashSessionToken(token)
  const res = await rest(
    `/sessions?token_hash=eq.${tokenHash}&select=expires_at,users(id,email,display_name,avatar_url)`,
  )
  if (!res.ok) {
    console.error(`auth: session lookup failed: HTTP ${res.status}`)
    return json({ error: 'session lookup failed' }, 500, headers)
  }
  const row = (await res.json())?.[0]
  if (!row) return json({ error: 'no session' }, 401, headers)
  if (isSessionExpired(new Date(row.expires_at))) {
    headers.append('Set-Cookie', clearSessionCookie())
    return json({ error: 'session expired' }, 401, headers)
  }
  return json({ user: row.users }, 200, headers)
}

Deno.serve(async (req: Request): Promise<Response> => {
  // AC #6: every request fails loudly while config is missing.
  if (!configured) {
    return json({ error: 'auth not configured' }, 500, withCors(new Headers()))
  }

  const path = new URL(req.url).pathname
  if (req.method === 'OPTIONS') {
    const headers = withCors(new Headers())
    // CYJ-10: the apikey credential header triggers a preflight on the
    // client's cross-site /auth/google/start fetch — it must be allowed.
    // CYJ-15: so does x-cyj-session on /auth/me (a non-simple header).
    headers.set('Access-Control-Allow-Headers', 'Content-Type, apikey, x-cyj-session')
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405, withCors(new Headers()))
  }

  if (path.endsWith('/google/start')) return handleStart(req)
  if (path.endsWith('/google/callback')) return handleGoogleCallback(req)
  if (path.endsWith('/me')) return handleMe(req)
  return json({ error: 'not found' }, 404, withCors(new Headers()))
})
