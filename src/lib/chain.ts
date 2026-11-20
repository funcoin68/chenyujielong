/**
 * Shared idiom-chain primitives. Server-side (Edge Function) and client-side
 * validation both import from here so rules never drift apart.
 */

/** Last character of an idiom, punctuation stripped. */
export function lastChar(idiom: string): string {
  const trimmed = idiom.trim().replace(/[，。！？；、\s]+$/u, '')
  if (!trimmed) throw new Error('empty idiom')
  return Array.from(trimmed).at(-1)!
}

/** First character of a move, leading punctuation stripped. */
export function firstChar(move: string): string {
  const trimmed = move.trim().replace(/^[\s，。！？；、]+/u, '')
  if (!trimmed) throw new Error('empty move')
  return Array.from(trimmed)[0]
}

/** Strict chain rule: move must start with the previous idiom's last character. */
export function isChainValid(previousIdiom: string, move: string): boolean {
  return firstChar(move) === lastChar(previousIdiom)
}
