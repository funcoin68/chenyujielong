/**
 * Public client config. VITE_* values are baked into the bundle at build
 * time — public by design, never secrets. Empty string means "not set".
 */
export const FUNCTIONS_URL: string = import.meta.env.VITE_FUNCTIONS_URL ?? ''
