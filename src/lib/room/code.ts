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
