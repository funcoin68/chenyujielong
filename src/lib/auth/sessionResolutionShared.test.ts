import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * AC #3: session resolution in room-authority uses the IDENTICAL lookup path
 * as /auth/me. Both Edge Functions run on Deno and touch `Deno.env` at module
 * top level, so they cannot be imported into Vitest — this test asserts the
 * contract at the source level: each function must import `resolveUserId`
 * from the shared module `src/lib/auth/session.ts` and must not carry its own
 * token->user resolution (no copy of resolveSessionToken's cookie/header
 * choice, no inline hashSessionToken call outside the shared lib).
 */
const AUTH_FN = fileURLToPath(
  new URL('../../../supabase/functions/auth/index.ts', import.meta.url),
)
const ROOM_AUTHORITY_FN = fileURLToPath(
  new URL('../../../supabase/functions/room-authority/index.ts', import.meta.url),
)
const SHARED_MODULE = '../../../src/lib/auth/session.ts'

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('session resolution is one shared module (CYJ-20 AC #3)', () => {
  for (const [name, path] of [
    ['auth (handleMe / /auth/me)', AUTH_FN],
    ['room-authority (create-room)', ROOM_AUTHORITY_FN],
  ] as const) {
    it(`${name} resolves sessions via resolveUserId from ${SHARED_MODULE}`, () => {
      const source = readSource(path)
      expect(
        source,
        `${name} must import resolveUserId from the shared session module`,
      ).toMatch(new RegExp(`import\\s*{[^}]*\\bresolveUserId\\b[^}]*}\\s*from\\s*['"]${SHARED_MODULE}['"]`))
      expect(
        source.match(/\bresolveUserId\s*\(/g)?.length ?? 0,
        `${name} must call resolveUserId (import alone is not the shared path)`,
      ).toBeGreaterThanOrEqual(1)
    })
  }

  it('neither function re-implements token selection inline (no drift from resolveSessionToken)', () => {
    // parseCookies(...)[...] or resolveSessionToken( outside the shared lib is
    // a second copy of the cookie-first/header-fallback rule — forbidden.
    for (const path of [AUTH_FN, ROOM_AUTHORITY_FN]) {
      const source = readSource(path)
      expect(source).not.toMatch(/resolveSessionToken\s*\(/)
      expect(source).not.toMatch(/parseCookies\s*\([^)]*\)\s*\[\s*SESSION_COOKIE\s*\]/)
    }
  })

  it('room-authority passes the x-cyj-session header into the shared resolver', () => {
    expect(readSource(ROOM_AUTHORITY_FN)).toMatch(
      /resolveUserId\([\s\S]*?x-cyj-session/,
    )
  })

  it('room-authority allows the x-cyj-session header in its CORS preflight response', () => {
    const source = readSource(ROOM_AUTHORITY_FN)
    expect(source).toMatch(/Access-Control-Allow-Headers['"]?\s*,?\s*['"][^'"]*x-cyj-session/)
  })
})
