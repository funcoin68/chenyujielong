import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// config.ts bakes VITE_* values at module load, so each case stubs the env
// and re-imports the module fresh (CYJ-10 round 2: FUNCTIONS_URL resolution).
async function loadConfig(): Promise<typeof import('./config')> {
  return await import('./config')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('FUNCTIONS_URL resolution (CYJ-10)', () => {
  it('uses VITE_FUNCTIONS_URL verbatim when it already ends with /functions/v1', async () => {
    vi.stubEnv('VITE_FUNCTIONS_URL', 'https://proj.supabase.co/functions/v1')
    const { FUNCTIONS_URL } = await loadConfig()
    expect(FUNCTIONS_URL).toBe('https://proj.supabase.co/functions/v1')
  })

  it('appends a missing /functions/v1 suffix and warns loudly — the bare-origin misconfiguration that broke prod sign-in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_FUNCTIONS_URL', 'https://proj.supabase.co')
    const { FUNCTIONS_URL } = await loadConfig()
    expect(FUNCTIONS_URL).toBe('https://proj.supabase.co/functions/v1')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('derives <supabase-url>/functions/v1 from VITE_SUPABASE_URL when VITE_FUNCTIONS_URL is unset (CI builds set only the former)', async () => {
    vi.stubEnv('VITE_FUNCTIONS_URL', undefined)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
    const { FUNCTIONS_URL } = await loadConfig()
    expect(FUNCTIONS_URL).toBe('https://proj.supabase.co/functions/v1')
  })

  it('resolves to empty string when neither var is set, preserving the "auth not configured" gate at Landing', async () => {
    vi.stubEnv('VITE_FUNCTIONS_URL', undefined)
    vi.stubEnv('VITE_SUPABASE_URL', undefined)
    const { FUNCTIONS_URL } = await loadConfig()
    expect(FUNCTIONS_URL).toBe('')
  })
})
