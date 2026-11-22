/**
 * Google ID-token verification with WebCrypto only (CYJ-7 AC #3) — no JWT
 * library, so it runs identically in Deno and Node. Returns the claims on
 * success, null on ANY failure; callers treat null as 401.
 */

export interface GoogleClaims {
  sub: string
  iss: string
  aud: string
  exp: number
  email?: string
  name?: string
  picture?: string
}

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const CLOCK_LEEWAY_SECONDS = 60

function b64urlDecode(part: string): Uint8Array {
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad) b64 += '='.repeat(4 - pad)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(part)))
  } catch {
    return null
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  jwks: { keys: JsonWebKey[] },
  clientId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<GoogleClaims | null> {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null

  const header = decodeJson(parts[0])
  if (!header) return null
  // Pin the algorithm BEFORE any verification — accepting 'none' or HS256
  // (public key misused as HMAC secret) is the classic JWT confusion break.
  if (header.alg !== 'RS256') return null

  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA')
  if (!jwk) return null

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return null
  }

  let signature: Uint8Array
  try {
    signature = b64urlDecode(parts[2])
  } catch {
    return null
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
  if (!valid) return null

  const claims = decodeJson(parts[1])
  if (!claims) return null
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) return null
  if (claims.aud !== clientId) return null
  if (typeof claims.exp !== 'number' || nowSeconds > claims.exp + CLOCK_LEEWAY_SECONDS) {
    return null
  }

  return claims as unknown as GoogleClaims
}
