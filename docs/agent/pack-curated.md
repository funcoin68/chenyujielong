# Curated sections for the onboarding pack (TIER 0 — human-edited)

This file is the human-owned source for the narrative sections of
docs/agent/onboarding-pack.md. Edit THIS file; the pack itself is regenerated
by scripts/build_context_pack.py (nightly workflow or manual run), which
splices these sections together with the mechanical ones (module map,
hotspots, recent decisions).

## 0. Mission
成语接龙 (Chinese idiom-chain) multiplayer web game — players take turns
chaining idioms, each starting with the last character of the previous one.
It is also the practice vehicle for the agentic delivery pipeline, so pipeline
infrastructure (scripts/, .github/workflows/) lives in the same repo as the
game. Keep game code and pipeline code conceptually separate.

## 2. Request lifecycle
Current state (post CYJ-6): the UI is a full mock-up. App.tsx mounts
react-router routes; every screen renders from src/mock/data.ts fixtures with
NO network calls, no auth, no Supabase.

The one live server path is move validation:
client POST → Supabase Edge Function validate-move (transport only: method,
1KB body cap, JSON parse) → src/lib/validateMove.ts (input + rule mapping) →
src/lib/chain.ts (chain rule primitives) → JSON {valid, reason?}.
src/lib/ is shared verbatim between the Deno Edge Function and Vitest so
client-tested rules and server-enforced rules can never drift apart.

Planned (not built): rooms/players/moves in Postgres with Supabase Realtime
for presence, and a room-authority Edge Function owning turn order/scoring.

## 3. Data model
No database schema exists yet — supabase/migrations/ does not exist and there
are no tables. All "data" is src/mock/data.ts fixtures. When the schema lands:
migrations via `supabase db diff` only, never hand-edited after apply
(CLAUDE.md). Planned entities: rooms, players, moves (chain entries).

## 4. API / interface contracts
- POST /functions/v1/validate-move — body {previousIdiom: string, move: string}.
  200 {valid:true} · 400 {valid:false, reason} (bad input OR chain violation —
  both are 400, never 500) · 405 non-POST · 413 body >1KB.
  JWT-pinned (root supabase/config.toml [functions.validate-move] verify_jwt=true).
- Frontend routes (spec §3): / Landing · /lobby · /room/:roomId WaitingRoom ·
  /room/:roomId/play Gameplay · /room/:roomId/results Results · /profile ·
  * → Landing. AppRoutes is exported separately so tests mount MemoryRouter.
- Preview/staging URLs carry feature flags as ?flags=flag-<ticket>.

## 5. Conventions
- Test: `npm test -- --run` (Vitest). Coverage: `npm run coverage`
  (v8 provider; json-summary output is the CI gate input).
- Lint: `npm run lint` (ESLint 9 flat config) before every commit.
- Node 26 (.nvmrc + engines), TypeScript ~5.6, ES modules ("type":"module").
- Files shared with Deno (src/lib/) import with EXPLICIT .ts extensions.
- One CSS file per component/screen, co-located (Component.tsx + Component.css).
- Design tokens are test-locked (src/tokens.test.ts: OKLCH pairing, WCAG
  contrast, CJK fallback stack, prefers-reduced-motion).
- Idiom validation is server-authoritative — never trust client-side checks.

## 6. Gotchas (highest-value section — fill from real incidents/reviews)
- chain.ts strips CJK punctuation, then THROWS on empty/punctuation-only
  input. validateMove maps that throw to a 400 — any new caller must too.
- The Edge Function reaches INTO src/lib via ../../../ relative imports.
  Moving/renaming src/lib files breaks the Deno deploy, not just the build.
- Do NOT remove the explicit .ts import extensions in src/lib consumers —
  Deno requires them; TS tooling tolerates them.
- Vercel Deployment Protection must be OFF for previews or QA/smoke gets 401.
- supabase CLI v3 headless: `functions deploy --remote=<ref> --yes` (the '='
  form is mandatory); `db push --remote=<ref> --password --yes`.
- Editing a Jira automation flow wipes hidden webhook headers — re-paste
  DISPATCH_TOKEN after any flow edit.
- Keep PR bodies LF-only; a Windows/CRLF edit once broke the scope guard's
  modules: parsing (guard now hardened, but don't rely on it).

## 9. Open risks / known debt
- No persistence layer: no schema, no migrations, no Realtime — game state is
  mock fixtures; multi-player is not real yet.
- No auth; no room-authority function (turn order/scoring unenforced).
- Component tests are render-smoke only (App.render.test.tsx); coverage gate
  is effectively scoped to src/lib until screen interaction tests exist.
- docs/agent/CYJ-6-implementation-notes.md is a PR-body workaround artifact —
  delete once absorbed (see its own header).
