/**
 * CYJ-35: presentation-only name capitalization. Uppercases the first cased
 * letter of each whitespace-separated token and leaves the rest of the token
 * untouched — `wei chen` → `Wei Chen`, already-capitalized names pass through
 * unchanged (idempotent), and CJK names are unaffected (`toUpperCase()` is
 * identity on uncased characters). Never writes to users.display_name; apply
 * only at render/derivation time on already-fetched strings.
 */
export function capitalizeName(name: string): string {
  return name.replace(/(^|\s)(\p{L})/gu, (_match, sep: string, ch: string) => sep + ch.toUpperCase())
}
