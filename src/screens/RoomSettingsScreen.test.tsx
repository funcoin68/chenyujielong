// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RoomSettingsScreen from './RoomSettingsScreen'
import Lobby from './Lobby'
import { memoryStorage } from '../auth/memoryStorage'
import { invalidateSessionCache } from '../auth/sessionClient'

// Same harness pattern as WaitingRoom.test.tsx: the functions URL is baked at
// build time, so tests provide one (production sets VITE_FUNCTIONS_URL).
vi.mock('../config', () => ({ FUNCTIONS_URL: 'https://fn.example', SUPABASE_ANON_KEY: 'anon-key' }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

// The real room the stubbed room-authority returns — every pre-fill assertion
// is against THIS payload, and AC #1 asserts exactly one GET for it.
const PAYLOAD = {
  room: {
    roomId: 'r-real-1',
    code: 'ZZ99ZZ',
    name: 'Real Room',
    status: 'waiting',
    ownerId: 'u-host',
    maxPlayers: 4,
    rule: 'homophone',
    turnSeconds: 60,
    winCondition: 'elimination',
    dictionary: 'full',
  },
  players: [
    { userId: 'u-host', name: 'Host Han', avatarUrl: null, isHost: true },
    { userId: 'u-guest', name: 'Greta Guest', avatarUrl: null, isHost: false },
  ],
}

const HOST_ME = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        user: { id: 'u-host', email: 'h@x.test', display_name: 'Host Han', avatar_url: null },
      }),
      { status: 200 },
    ),
  )

const GUEST_ME = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        user: { id: 'u-guest', email: 'g@x.test', display_name: 'Greta Guest', avatar_url: null },
      }),
      { status: 200 },
    ),
  )

async function renderSettingsScreen(
  route: string,
  handlers: {
    room?: (url: string) => Promise<Response>
    me?: () => Promise<Response>
    update?: (body: unknown) => Promise<Response>
  } = {},
): Promise<{ container: HTMLElement; roomUrls: string[]; updateBodies: unknown[] }> {
  const roomUrls: string[] = []
  const updateBodies: unknown[] = []
  const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
    const urlString = String(url)
    if (urlString.includes('/room-authority/room/')) {
      roomUrls.push(urlString)
      return (handlers.room ?? (() => Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }))))(
        urlString,
      )
    }
    if (urlString.includes('/update-room')) {
      const body = JSON.parse(String(init?.body))
      updateBodies.push(body)
      return (handlers.update ?? (() => Promise.resolve(new Response(null, { status: 200 }))))(body)
    }
    // /auth/me answers the host/guest/visitor resolution; signed out by default.
    return (handlers.me ?? (() => Promise.resolve(new Response('{"error":"no session"}', { status: 401 }))))()
  })
  vi.stubGlobal('fetch', fetchMock)

  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/room/:roomId/settings" element={<RoomSettingsScreen />} />
          <Route path="/lobby" element={<Lobby />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  // Flush the microtask queue so the fetches' state updates land inside act()
  // (same pattern as WaitingRoom.test.tsx).
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return { container, roomUrls, updateBodies }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function checkedRadioText(container: HTMLElement, name: string): string | undefined {
  const checked = Array.from(container.querySelectorAll(`input[name="${name}"]`)).find(
    (i) => (i as HTMLInputElement).checked,
  )
  return checked?.closest('label')?.textContent?.trim()
}

function selectedChipText(container: HTMLElement, groupLabel: string): string | undefined {
  const group = container.querySelector(`[role="group"][aria-label="${groupLabel}"]`)
  return Array.from(group?.querySelectorAll('button') ?? [])
    .find((b) => b.getAttribute('aria-pressed') === 'true')
    ?.textContent?.trim()
}

async function editName(container: HTMLElement, value: string) {
  await act(async () => {
    const input = container.querySelector('.room-settings-name') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  })
}

async function submitForm(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector('form.room-settings')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
  })
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // fetchCurrentUser caches per token — reset so a previous test's cache can't
  // suppress this test's mount-time fetch.
  invalidateSessionCache()
})

describe('RoomSettingsScreen (CYJ-28)', () => {
  it('AC #1: issues exactly one GET to room/:id and renders every field pre-filled', async () => {
    const { container, roomUrls } = await renderSettingsScreen('/room/r-real-1/settings', { me: HOST_ME })

    expect(roomUrls).toHaveLength(1)
    expect(roomUrls[0]).toContain('/room-authority/room/r-real-1')

    const nameInput = container.querySelector('.room-settings-name') as HTMLInputElement
    expect(nameInput.value).toBe('Real Room')
    expect(checkedRadioText(container, 'rule')).toContain('Homophone')
    expect(selectedChipText(container, 'Turn timer')).toBe('60s')
    expect(selectedChipText(container, 'Players')).toBe('4')
    expect(checkedRadioText(container, 'win')).toContain('Elimination')
    expect(checkedRadioText(container, 'dict')).toContain('Full')
  })

  it('AC #2: 404 redirects to /lobby with a visible notice', async () => {
    const { container } = await renderSettingsScreen('/room/r-missing/settings', {
      room: () => Promise.resolve(new Response('{"error":"room not found"}', { status: 404 })),
    })
    // The Lobby route is mounted, so the redirect renders lobby content…
    expect(container.textContent).toContain('Quick Play')
    // …plus the notice handed over via router state, visibly.
    const notice = container.querySelector('[role="status"]')
    expect(notice?.textContent).toContain('Room not found.')
  })

  it('AC #2: a failed GET (500) redirects to /lobby with a visible notice', async () => {
    const { container } = await renderSettingsScreen('/room/r-broken/settings', {
      room: () => Promise.resolve(new Response('{"error":"room lookup failed"}', { status: 500 })),
    })
    expect(container.textContent).toContain('Quick Play')
    const notice = container.querySelector('[role="status"]')
    expect(notice?.textContent).toContain('could not load room')
  })

  it('AC #3: the host sees editable fields and an enabled Save button', async () => {
    const { container } = await renderSettingsScreen('/room/r-real-1/settings', { me: HOST_ME })

    const nameInput = container.querySelector('.room-settings-name') as HTMLInputElement
    expect(nameInput.readOnly).toBe(false)
    for (const chip of Array.from(container.querySelectorAll('.room-settings-chip'))) {
      expect((chip as HTMLButtonElement).disabled).toBe(false)
    }
    for (const radio of Array.from(container.querySelectorAll('input[type="radio"]'))) {
      expect((radio as HTMLInputElement).disabled).toBe(false)
    }
    const save = container.querySelector('button[type="submit"]') as HTMLButtonElement | null
    expect(save).not.toBeNull()
    expect(save?.textContent).toContain('Save Settings')
    expect(save?.disabled).toBe(false)
  })

  it('AC #3: a non-host sees read-only fields and no Save button', async () => {
    const { container } = await renderSettingsScreen('/room/r-real-1/settings', { me: GUEST_ME })

    const nameInput = container.querySelector('.room-settings-name') as HTMLInputElement
    expect(nameInput.readOnly).toBe(true)
    for (const chip of Array.from(container.querySelectorAll('.room-settings-chip'))) {
      expect((chip as HTMLButtonElement).disabled).toBe(true)
    }
    for (const radio of Array.from(container.querySelectorAll('input[type="radio"]'))) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
    }
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })

  it('AC #3: a signed-out visitor sees read-only fields and no Save button', async () => {
    const { container } = await renderSettingsScreen('/room/r-real-1/settings')

    const nameInput = container.querySelector('.room-settings-name') as HTMLInputElement
    expect(nameInput.readOnly).toBe(true)
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })

  it('AC #3: editability follows ownerId, not the players list is_host flag (review round 1)', async () => {
    // The payload's players mark u-host as isHost — but the server authorizes
    // by rooms.ownerId. A flagged non-owner (u-guest) must NOT see an editable
    // form that would 403 on save.
    const { container } = await renderSettingsScreen('/room/r-real-1/settings', {
      me: GUEST_ME,
      room: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ...PAYLOAD,
              players: [
                { userId: 'u-host', name: 'Host Han', avatarUrl: null, isHost: false },
                { userId: 'u-guest', name: 'Greta Guest', avatarUrl: null, isHost: true },
              ],
            }),
            { status: 200 },
          ),
        ),
    })
    expect((container.querySelector('.room-settings-name') as HTMLInputElement).readOnly).toBe(true)
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })

  it('AC #4: Save sends one update request with the full payload; 200 shows confirmation and keeps the values', async () => {
    const { container, updateBodies } = await renderSettingsScreen('/room/r-real-1/settings', { me: HOST_ME })

    await editName(container, 'Renamed Room')
    await submitForm(container)

    expect(updateBodies).toHaveLength(1)
    expect(updateBodies[0]).toEqual({
      roomId: 'r-real-1',
      name: 'Renamed Room',
      rule: 'homophone',
      turnSeconds: 60,
      maxPlayers: 4,
      winCondition: 'elimination',
      dictionary: 'full',
    })

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Settings saved')
    // The fields retain the saved values.
    expect((container.querySelector('.room-settings-name') as HTMLInputElement).value).toBe('Renamed Room')
    expect(selectedChipText(container, 'Turn timer')).toBe('60s')
  })

  it('AC #5: a failed save shows a visible error and leaves the edited values untouched', async () => {
    const { container, updateBodies } = await renderSettingsScreen('/room/r-real-1/settings', {
      me: HOST_ME,
      update: () => Promise.resolve(new Response('{"error":"room update failed"}', { status: 500 })),
    })

    await editName(container, 'Renamed Room')
    await submitForm(container)

    expect(updateBodies).toHaveLength(1)
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('could not update room')
    // No data loss: the user's edits are still in the form.
    expect((container.querySelector('.room-settings-name') as HTMLInputElement).value).toBe('Renamed Room')
    expect(selectedChipText(container, 'Turn timer')).toBe('60s')
  })
})
