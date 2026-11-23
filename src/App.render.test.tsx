import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from './App'
import { lastChar } from './lib/chain'
import { GAME_CHAIN, ROOM, STANDINGS, PROFILE } from './mock/data'

function renderRoute(route: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

const ROUTES = ['/', '/lobby', '/room/demo', '/room/demo/play', '/room/demo/results', '/profile']

describe('mock-up routes render without errors (AC #3)', () => {
  it.each(ROUTES)('route %s renders a <main> landmark', (route) => {
    const html = renderRoute(route)
    expect(html).toContain('<main')
  })

  // CYJ-19: server render never runs effects, so Landing's SSR output is the
  // session-check loading state, not the signed-in/signed-out auth control.
  it('landing shows the session-check loading indicator and wordmark', () => {
    const html = renderRoute('/')
    expect(html).toContain('role="status"')
    expect(html).toContain('成语接龙')
  })

  it('landing shows a visible error indicator after a failed Google callback (CYJ-7 AC #4)', () => {
    const html = renderRoute('/?auth_error=access_denied')
    expect(html).toContain('role="alert"')
    expect(html).toContain('access_denied')
  })

  it('lobby shows the Quick Play primary action and fixture rooms', () => {
    const html = renderRoute('/lobby')
    expect(html).toContain('Quick Play')
    expect(html).toContain('小明的房间')
    // icon-only header controls must be labelled (AC #4)
    expect(html).toMatch(/aria-label="[^"]*[Nn]otifications[^"]*"/)
  })

  it('waiting room shows the fixture room name and invite code', () => {
    const html = renderRoute(`/room/${ROOM.id}`)
    // renderToString escapes apostrophes as &#x27;
    expect(html).toContain(ROOM.name.replace(/'/g, '&#x27;'))
    for (const ch of ROOM.code) expect(html).toContain(ch)
  })

  it('gameplay prompts for the character derived from the fixture chain head', () => {
    const html = renderRoute(`/room/${ROOM.id}/play`)
    const head = GAME_CHAIN[GAME_CHAIN.length - 1].idiom
    expect(html).toContain(`「${lastChar(head)}」`)
    // turn clarity: prompt strip announces whose turn it is
    expect(html).toMatch(/aria-live="polite"/)
  })

  it('results show the fixture standings', () => {
    const html = renderRoute(`/room/${ROOM.id}/results`)
    expect(html).toContain('GAME OVER')
    for (const row of STANDINGS) {
      expect(html).toContain(row.name)
      expect(html).toContain(String(row.score))
    }
  })

  it('profile shows the fixture identity and stats', () => {
    const html = renderRoute('/profile')
    expect(html).toContain(PROFILE.name)
    expect(html).toContain('Games played')
  })
})
