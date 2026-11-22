import { describe, it, expect } from 'vitest'
import { verifyGoogleIdToken } from './googleIdToken'

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
const KID = 'test-key'

function b64url(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeKeyPair(kid: string) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { pair, jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } }
}

interface SignOptions {
  claims?: Record<string, unknown>
  header?: Record<string, unknown>
}

async function signToken(pair: CryptoKeyPair, opts: SignOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', kid: KID, typ: 'JWT', ...opts.header }
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-123',
    email: 'player@example.com',
    name: 'Test Player',
    picture: 'https://example.com/p.png',
    iat: now,
    exp: now + 3600,
    ...opts.claims,
  }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(data),
  )
  return `${data}.${b64url(new Uint8Array(sig))}`
}

describe('verifyGoogleIdToken (AC #3)', () => {
  it('returns the claims for a correctly signed Google token', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const claims = await verifyGoogleIdToken(await signToken(pair), jwks, CLIENT_ID)
    expect(claims).not.toBeNull()
    expect(claims!.email).toBe('player@example.com')
    expect(claims!.sub).toBe('google-sub-123')
  })

  it('accepts the legacy issuer "accounts.google.com" (no scheme)', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { claims: { iss: 'accounts.google.com' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).not.toBeNull()
  })

  it('rejects a token signed with a different key', async () => {
    const { jwks } = await makeKeyPair(KID)
    const attacker = await makeKeyPair('attacker-key')
    // header still names the real kid, but the signature is from another key
    const token = await signToken(attacker.pair, { header: { kid: KID } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects alg "none" before any verification', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { header: { alg: 'none' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects HS256 (algorithm confusion)', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { header: { alg: 'HS256' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects a wrong audience', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { claims: { aud: 'some-other-client' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects a wrong issuer', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { claims: { iss: 'https://evil.example.com' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const now = Math.floor(Date.now() / 1000)
    const token = await signToken(pair, { claims: { exp: now - 3600 } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })

  it('tolerates expiry inside the 60s clock leeway', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const now = Math.floor(Date.now() / 1000)
    const token = await signToken(pair, { claims: { exp: now - 30 } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).not.toBeNull()
  })

  it('rejects a malformed token', async () => {
    const { jwks } = await makeKeyPair(KID)
    expect(await verifyGoogleIdToken('not-a-jwt', jwks, CLIENT_ID)).toBeNull()
  })

  it('rejects an unknown key id', async () => {
    const { pair, jwks } = await makeKeyPair(KID)
    const token = await signToken(pair, { header: { kid: 'no-such-key' } })
    expect(await verifyGoogleIdToken(token, jwks, CLIENT_ID)).toBeNull()
  })
})
