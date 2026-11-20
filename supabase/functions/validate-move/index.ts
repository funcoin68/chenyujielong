// validate-move: server-authoritative idiom-chain validation.
// Transport only — rule logic lives in src/lib/ (see supabase/functions/README.md).
import { validateMove } from '../../../src/lib/validateMove.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ valid: false, reason: 'method not allowed' }, { status: 405 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ valid: false, reason: 'request body must be JSON' }, { status: 400 })
  }

  const result = validateMove(body)
  return Response.json(result.body, { status: result.status })
})
