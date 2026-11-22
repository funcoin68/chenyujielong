/**
 * Public client config. VITE_* values are baked into the bundle at build
 * time — public by design, never secrets. Empty string means "not set".
 *
 * FUNCTIONS_URL must be the Supabase Edge Functions gateway:
 * `<supabase-project-url>/functions/v1`. CYJ-10: the prod bundle was built
 * with a bare project origin (no /functions/v1), so sign-in fetched a
 * route-less URL and failed before any Google redirect existed. Resolution:
 * VITE_FUNCTIONS_URL if set, else derived from VITE_SUPABASE_URL (CI builds
 * set only the latter); a missing suffix is appended with a loud warning
 * rather than shipped silently (rule 12).
 */
const FUNCTIONS_SUFFIX = '/functions/v1'

function withoutTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

function resolveFunctionsUrl(): string {
  const explicit = withoutTrailingSlashes(import.meta.env.VITE_FUNCTIONS_URL ?? '')
  if (explicit) {
    if (explicit.endsWith(FUNCTIONS_SUFFIX)) return explicit
    console.warn(
      `config: VITE_FUNCTIONS_URL "${explicit}" lacks the ${FUNCTIONS_SUFFIX} suffix — appending it. ` +
        'Set it to the full Edge Functions URL to silence this warning.',
    )
    return `${explicit}${FUNCTIONS_SUFFIX}`
  }
  const supabaseUrl = withoutTrailingSlashes(import.meta.env.VITE_SUPABASE_URL ?? '')
  return supabaseUrl ? `${supabaseUrl}${FUNCTIONS_SUFFIX}` : ''
}

export const FUNCTIONS_URL: string = resolveFunctionsUrl()
// Publishable anon key — public by design, like every VITE_* value above.
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
