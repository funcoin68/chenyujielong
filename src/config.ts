/**
 * Public client config. VITE_* values are baked into the bundle at build
 * time — public by design, never secrets. Empty string means "not set".
 */
export const FUNCTIONS_URL: string = import.meta.env.VITE_FUNCTIONS_URL ?? ''
// Publishable anon key — public by design, like every VITE_* value above.
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
