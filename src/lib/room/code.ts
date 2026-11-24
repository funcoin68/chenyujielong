/**
 * Room join codes (CYJ-17). 6 characters from an uppercase alphabet with the
 * visually ambiguous 0/O/1/I removed, so a code read aloud or copied by hand
 * cannot be mistaken. Transport-free so Vitest and the Deno Edge Function
 * share it verbatim (imported with explicit .ts extensions).
 */

// 32 chars: A–Z minus O and I, plus 2–9 minus 0 and 1.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

export function generateRoomCode(length: number = ROOM_CODE_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * CYJ-31: the one home for "is this a plausible room code" — uppercase, exactly
 * ROOM_CODE_LENGTH, every character in the unambiguous ALPHABET (rejects
 * O/0/I/1 and lowercase). Lives next to the generator so the validator and the
 * generator can never drift on the alphabet (rules 7/11).
 */
export function isWellFormedRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH &&
    Array.from(code).every((ch) => ALPHABET.includes(ch))
  )
}
