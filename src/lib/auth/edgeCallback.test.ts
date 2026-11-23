/**
 * CYJ-18 regression: supabase/functions/auth/index.ts called parseCookies
 * without importing it, so every /auth/google/callback crashed with
 * `ReferenceError: parseCookies is not defined` (500). This test executes
 * the REAL Deno entry file under Node — the Deno global is stubbed (env +
 * serve captures the request handler), fetch is routed by URL — so the
 * crash class this ticket fixes can never regress silently: edge functions
 * are invisible to eslint/vitest/tsc config otherwise.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

// The Edge Function file under test references the Deno global at module top
// level; declaring its minimal structural shape here keeps `tsc -b` (which
// follows the import below into supabase/functions/) clean without a Deno
// toolchain dependency.
interface DenoLike {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
declare global {
  var Deno: DenoLike
}

const CLIENT_ID = 'test-google-client-id'
const APP_BASE_URL = 'https://app.example.com'
const SUPABASE_URL = 'https://supabase.example.com'
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  APP_BASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}

type CapturedHandler = (req: Request) => Response | Promise<Response>

let handler: CapturedHandler | null = null
let exchangeCalls = 0
let publicJwk: (JsonWebKey & { kid?: string }) | null = null
let idToken = ''

function b64url(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function buildSignedIdToken(
  keyPair: CryptoKeyPair,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = { alg: 'RS256', kid: 'test-kid', typ: 'JWT' }
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)))
  const signingInput = `${enc(header)}.${enc(claims)}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${b64url(signature)}`
}

async function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === 'https://oauth2.googleapis.com/token') {
    exchangeCalls += 1
    return new Response(JSON.stringify({ id_token: idToken }), { status: 200 })
  }
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  }
  if (url.startsWith(`${SUPABASE_URL}/rest/v1/users`)) {
    return new Response(JSON.stringify([{ id: 'user-1' }]), { status: 200 })
  }
  if (url === `${SUPABASE_URL}/rest/v1/sessions`) {
    return new Response('{}', { status: 200 })
  }
  throw new Error(`unexpected fetch in edge callback test: ${url}`)
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & {
    kid?: string
  }
  jwk.kid = 'test-kid'
  jwk.alg = 'RS256'
  publicJwk = jwk
  idToken = await buildSignedIdToken(keyPair, {
    iss: 'accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'google-sub-1',
    email: 'player@example.com',
    name: 'Player One',
  })

  vi.stubGlobal('Deno', {
    env: { get: (name: string) => ENV[name] },
    serve: (h: CapturedHandler) => {
      handler = h
    },
  })
  vi.stubGlobal('fetch', vi.fn(mockFetch))

  // Importing the real Deno entry file runs its module top-level (env checks
  // + Deno.serve) against the stubs; a new top-level Deno.* call would fail
  // loudly here, which is the desired behavior.
  await import('../../../supabase/functions/auth/index.ts')
  if (!handler) throw new Error('Deno.serve stub never captured the request handler')
})

function callbackRequest(query: string): Request {
  return new Request(
    `${APP_BASE_URL}/functions/v1/auth/google/callback${query ? `?${query}` : ''}`,
  )
}

describe('auth edge function /google/callback (CYJ-18: parseCookies regression)', () => {
  it('AC #1/#3: matching state reaches the Google code exchange and returns 302, never the parseCookies 500', async () => {
    exchangeCalls = 0
    const res = await handler!(callbackRequest('code=authcode-1&state=X&stored=X'))
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain(`${APP_BASE_URL}/lobby`)
    expect(location).toContain('#cyj_session=')
    expect(exchangeCalls).toBe(1)
  })

  it('AC #2: mismatched state is rejected BEFORE the code exchange (redirect with auth_error=state_mismatch)', async () => {
    exchangeCalls = 0
    const res = await handler!(callbackRequest('code=authcode-1&state=X&stored=Y'))
    expect(exchangeCalls).toBe(0)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('auth_error=state_mismatch')
  })

  it('smoke: a request without code/state still gets a mapped decision, never a 500 from the handler itself', async () => {
    exchangeCalls = 0
    const res = await handler!(callbackRequest(''))
    expect(exchangeCalls).toBe(0)
    expect(res.status).not.toBe(500)
    expect(res.headers.get('location')).toContain('auth_error=')
  })
})
