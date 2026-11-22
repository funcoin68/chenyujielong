import { describe, it, expect } from 'vitest'
import {
  buildAuthorizeUrl,
  encodeStateWithFlags,
  flagsFromState,
  generateState,
  handleCallback,
} from './flow'
import { SESSION_COOKIE, hashSessionToken } from './session'
import type { GoogleClaims } from './googleIdToken'

const APP = 'https://idiom.example.com'

const CLAIMS: GoogleClaims = {
  sub: 'google-sub-1',
  iss: 'https://accounts.google.com',
  aud: 'client-id',
  exp: 9999999999,
  email: 'player@example.com',
  name: 'Test Player',
  picture: 'https://example.com/p.png',
}

function query(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init)
}

function sessionCookieValue(setCookies: string[]): string | undefined {
  return setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
}

describe('buildAuthorizeUrl', () => {
  it('targets Google with the authorization-code parameters', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://f.example/cb', state: 'st' }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://f.example/cb')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('scope')).toContain('openid')
    expect(url.searchParams.get('scope')).toContain('email')
  })

  it('generates unique URL-safe state values', () => {
    const a = generateState()
    expect(a).not.toBe(generateState())
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('state flag persistence (CYJ-8 AC #4 fix)', () => {
  it('round-trips flags through the composite state value', () => {
    const state = encodeStateWithFlags('random-part', 'flag-cyj-7,flag-x')
    expect(state).toBe('random-part.flag-cyj-7%2Cflag-x')
    expect(flagsFromState(state)).toBe('flag-cyj-7,flag-x')
  })

  it('leaves the state bare when there are no flags', () => {
    expect(encodeStateWithFlags('random-part', null)).toBe('random-part')
    expect(flagsFromState('random-part')).toBeNull()
  })

  it('returns null for a trailing separator or malformed encoding', () => {
    expect(flagsFromState('random-part.')).toBeNull()
    expect(flagsFromState('random-part.%')).toBeNull()
    expect(flagsFromState(null)).toBeNull()
  })

  it('base64url randomness never contains the . separator', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('handleCallback — Google error branch (AC #4)', () => {
  it('redirects to the login page with an error indicator and issues NO session', async () => {
    const decision = await handleCallback({
      query: query({ error: 'access_denied' }),
      stateCookie: 'whatever',
      claims: null,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=access_denied`)
    expect(sessionCookieValue(decision.setCookies)).toBeUndefined()
    expect(decision.session).toBeUndefined()
    expect(decision.userUpsert).toBeUndefined()
  })

  it('echoes the flags carried in state into the error redirect', async () => {
    const state = encodeStateWithFlags('random-part', 'flag-cyj-7')
    const decision = await handleCallback({
      query: query({ error: 'access_denied', state }),
      stateCookie: state,
      claims: null,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=access_denied&flags=flag-cyj-7`)
  })
})

describe('handleCallback — state validation', () => {
  // CYJ-8: failures must land back on the app with a visible error (AC #5),
  // not a raw 401 JSON page.
  it('redirects a state mismatch to the app with auth_error and no session', async () => {
    const decision = await handleCallback({
      query: query({ code: 'c', state: 'from-google' }),
      stateCookie: 'from-cookie',
      claims: CLAIMS,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=state_mismatch`)
    expect(sessionCookieValue(decision.setCookies)).toBeUndefined()
    expect(decision.session).toBeUndefined()
  })

  it('redirects a missing state cookie to the app with auth_error', async () => {
    const decision = await handleCallback({
      query: query({ code: 'c', state: 'from-google' }),
      stateCookie: undefined,
      claims: CLAIMS,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=state_mismatch`)
    expect(decision.session).toBeUndefined()
  })
})

describe('handleCallback — invalid ID token (AC #3)', () => {
  it('redirects to the app with auth_error and NO session cookie when token verification failed', async () => {
    const decision = await handleCallback({
      query: query({ code: 'c', state: 'st' }),
      stateCookie: 'st',
      claims: null,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=invalid_token`)
    expect(sessionCookieValue(decision.setCookies)).toBeUndefined()
    expect(decision.session).toBeUndefined()
    expect(decision.userUpsert).toBeUndefined()
  })

  it('rejects a verified token that carries no email', async () => {
    const decision = await handleCallback({
      query: query({ code: 'c', state: 'st' }),
      stateCookie: 'st',
      claims: { ...CLAIMS, email: undefined },
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/?auth_error=invalid_token`)
    expect(decision.session).toBeUndefined()
  })
})

describe('handleCallback — success (AC #1, AC #2)', () => {
  it('upserts a google-provider user with null password hash and issues a session', async () => {
    const decision = await handleCallback({
      query: query({ code: 'c', state: 'st' }),
      stateCookie: 'st',
      claims: CLAIMS,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/lobby`)

    // AC #2: the upsert payload creates a google user with no password hash.
    // (Returning users hit the same upsert keyed on email — PostgREST
    // merge-duplicates reuses the row instead of inserting, covering AC #1.)
    expect(decision.userUpsert).toEqual({
      email: 'player@example.com',
      display_name: 'Test Player',
      avatar_url: 'https://example.com/p.png',
      auth_provider: 'google',
      password_hash: null,
    })

    // AC #1: an httpOnly session cookie is set, and its stored hash matches
    // the cookie token — the DB never sees the raw token.
    const cookie = sessionCookieValue(decision.setCookies)
    expect(cookie).toBeDefined()
    expect(cookie).toContain('HttpOnly')
    const token = cookie!.split(';')[0].slice(`${SESSION_COOKIE}=`.length)
    expect(decision.session).toBeDefined()
    expect(decision.session!.tokenHash).toBe(await hashSessionToken(token))
    expect(decision.session!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  // CYJ-8 AC #4 fix: this is the URL the real OAuth callback produces, and
  // Lobby.test.tsx renders exactly it — the flag survives the round-trip.
  it('echoes the flags carried in state into the lobby redirect', async () => {
    const state = encodeStateWithFlags('random-part', 'flag-cyj-7')
    const decision = await handleCallback({
      query: query({ code: 'c', state }),
      stateCookie: state,
      claims: CLAIMS,
      appBaseUrl: APP,
    })
    expect(decision.status).toBe(302)
    expect(decision.redirect).toBe(`${APP}/lobby?flags=flag-cyj-7`)
    expect(sessionCookieValue(decision.setCookies)).toBeDefined()
  })

  it('re-encodes flags so they cannot break out of the query string', async () => {
    const state = encodeStateWithFlags('random-part', 'flag-a,flag-b')
    const decision = await handleCallback({
      query: query({ code: 'c', state }),
      stateCookie: state,
      claims: CLAIMS,
      appBaseUrl: APP,
    })
    expect(decision.redirect).toBe(`${APP}/lobby?flags=flag-a%2Cflag-b`)
  })
})
