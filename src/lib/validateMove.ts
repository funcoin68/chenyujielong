import { isChainValid } from './chain.ts'

export interface ValidateMoveResult {
  status: 200 | 400
  body: { valid: boolean; reason?: string }
}

/**
 * Validates a validate-move request body and applies the chain rule.
 * Transport-free so Vitest (and the Edge Function) can both use it.
 * Imported with an explicit .ts extension so Deno can resolve it.
 */
export function validateMove(input: unknown): ValidateMoveResult {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof (input as Record<string, unknown>).previousIdiom !== 'string' ||
    typeof (input as Record<string, unknown>).move !== 'string'
  ) {
    return {
      status: 400,
      body: { valid: false, reason: 'expected {previousIdiom, move} as strings' },
    }
  }

  const { previousIdiom, move } = input as { previousIdiom: string; move: string }
  if (!previousIdiom.trim() || !move.trim()) {
    return {
      status: 400,
      body: { valid: false, reason: 'previousIdiom and move must be non-empty' },
    }
  }

  // isChainValid throws on punctuation-only input (chain.ts strips CJK
  // punctuation before checking emptiness); map that to a 400, never a 500.
  let chainValid: boolean
  try {
    chainValid = isChainValid(previousIdiom, move)
  } catch {
    return {
      status: 400,
      body: { valid: false, reason: 'previousIdiom and move must contain non-punctuation characters' },
    }
  }

  if (!chainValid) {
    return {
      status: 400,
      body: { valid: false, reason: 'move does not continue the chain' },
    }
  }

  return { status: 200, body: { valid: true } }
}
