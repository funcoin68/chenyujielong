/**
 * Pack §4 flag convention: preview/staging URLs carry feature flags as
 * `?flags=flag-a,flag-b`. Minimal parser — no flag registry exists yet.
 */
export function hasFlag(flag: string, params: URLSearchParams): boolean {
  const raw = params.get('flags')
  if (!raw) return false
  return raw
    .split(',')
    .map((f) => f.trim())
    .includes(flag)
}
