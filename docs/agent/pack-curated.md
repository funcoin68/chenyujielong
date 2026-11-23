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
Current state (post CYJ-7): App.tsx mounts react-router routes; gameplay
screens still render from src/mock/data.ts fixtures — no game-state network
calls, no Realtime. Auth is REAL: Google OAuth via supabase/functions/auth
(transport only: env checks, Google/PostgREST fetches, HTTP responses; every
branch decision lives in src/lib/auth/, shared verbatim with Vitest like
src/lib/) + users/sessions tables (§3). The AuthCallback screen handles the
OAuth redirect; Landing/Lobby are session-aware.

Live server paths:
- POST /functions/v1/validate-move (transport only) → src/lib/validateMove.ts
  → src/lib/chain.ts → JSON {valid, reason?}. JWT-pinned.
- GET /functions/v1/auth/{google/start, google/callback, me} — see §4.

Planned (not built): rooms/players/moves in Postgres with Supabase Realtime
for presence, and a room-authority Edge Function owning turn order/scoring.
## 3. Data model
Schema shipped under CYJ-7 (migration `20261122000000_auth_users_sessions.sql`,
applied by stage 9b via `supabase db push --remote=<ref> --password --yes`).
Auth-only so far:

- public.users — id (uuid), email (citext, unique), display_name, avatar_url,
  auth_provider, password_hash (NULL for OAuth users), created_at/updated_at.
- public.sessions — id, user_id → users ON DELETE CASCADE, token_hash
  (SHA-256 hex of the cookie token — the raw token never touches the DB),
  expires_at (indexed), created_at.
- RLS is ENABLED WITH NO POLICIES on both tables: only the service role (the
  auth Edge Function) can read or write; anon/authenticated clients get
  nothing. Never add permissive policies without a ticket.

Discipline: migrations via `supabase db diff` only, never hand-edited after
apply (CLAUDE.md). Planned entities NOT yet migrated: rooms, players, moves.
Trust the mechanical migrations list below over this prose.
## 4. API / interface contracts
- POST /functions/v1/validate-move — body {previousIdiom: string, move: string}.
  200 {valid:true} · 400 {valid:false, reason} (bad input OR chain violation —
  both are 400, never 500) · 405 non-POST · 413 body >1KB.
  JWT-pinned (root supabase/config.toml [functions.validate-move] verify_jwt=true).
- GET /functions/v1/auth/google/start — begin Google OAuth (browser navigation).
- GET /functions/v1/auth/google/callback — OAuth redirect target; the app
  route /auth/callback lands here (CYJ-14); sets the session cookie.
- GET /functions/v1/auth/me — identifies the caller via the x-cyj-session
  cookie header (CORS preflight allows apikey + x-cyj-session).
  [functions.auth] verify_jwt=false pinned in supabase/config.toml (CYJ-13) —
  browser navigations carry no Supabase JWT; never gate auth on JWT.
  Missing env (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_BASE_URL,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) is a LOUD cold-start 500, never
  a silent one (AC #6).
- Frontend routes (spec §3): / Landing · /lobby · /room/:roomId WaitingRoom ·
  /room/:roomId/play Gameplay · /room/:roomId/results Results · /profile ·
  /auth/callback AuthCallback · * → Landing. AppRoutes is exported separately
  so tests mount MemoryRouter.
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
- Persistence exists for AUTH only (users/sessions): game state is still
  mock fixtures; rooms/players/moves are not migrated; no Realtime —
  multi-player is not real yet.
- No room-authority function (turn order/scoring unenforced).
- Component tests are render-smoke only (App.render.test.tsx); coverage gate
  is effectively scoped to src/lib until screen interaction tests exist.
- docs/agent/CYJ-6-implementation-notes.md is a PR-body workaround artifact —
  delete once absorbed (see its own header).
