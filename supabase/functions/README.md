# Supabase Edge Functions (Deno)

Server-authoritative game logic lives here — turn validation, room authority.

- One folder per function: `supabase/functions/<name>/index.ts`
- Pure rule logic (idiom chain validation, scoring) belongs in `src/lib/`
  so Vitest can cover it and the frontend can reuse it; functions import the
  rules and handle transport/auth/persistence only.
- These run on Deno, not Node: they are excluded from `npm test`/`npm run lint`.

First planned function: `validate-move` (pilot ticket CYJ-1).
