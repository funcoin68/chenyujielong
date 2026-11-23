# Agent onboarding pack — chenyujielong
<!-- GENERATED FILE — do not edit by hand. Narrative sections come from
     docs/agent/pack-curated.md; mechanical sections from git. Regenerate:
     python scripts/build_context_pack.py (nightly workflow opens the PR). -->
<!-- source commit: 1617ca1 · generated: 2026-11-23 · pack owner: funcoin68 -->

## 0. Mission
成语接龙 (Chinese idiom-chain) multiplayer web game — players take turns
chaining idioms, each starting with the last character of the previous one.
It is also the practice vehicle for the agentic delivery pipeline, so pipeline
infrastructure (scripts/, .github/workflows/) lives in the same repo as the
game. Keep game code and pipeline code conceptually separate.

## 1. Module map
- `src/lib/` (15 files) — Shared rule primitives (Deno Edge Function + Vitest both import). chain.test.ts, chain.ts, code.test.ts, code.ts, createRoom.test.ts, createRoom.ts, edgeCallback.test.ts, flow.test.ts … (+7)
- `src/lib/auth/` (7 files) — Google OAuth flow + session logic (shared Deno + Vitest, CYJ-7). edgeCallback.test.ts, flow.test.ts, flow.ts, googleIdToken.test.ts, googleIdToken.ts, session.test.ts, session.ts
- `src/screens/` (19 files) — Route-level screens (spec §3). AuthCallback.css, AuthCallback.test.tsx, AuthCallback.tsx, Gameplay.css, Gameplay.tsx, Landing.css, Landing.test.tsx, Landing.tsx … (+11)
- `src/ui/` (13 files) — Reusable components (one CSS per component). ChainView.css, ChainView.tsx, CodeInput.css, CodeInput.tsx, IdiomTile.css, IdiomTile.tsx, Modal.css, Modal.test.tsx … (+5)
- `src/mock/` (1 files) — Fixture data — the entire current 'backend'. data.ts
- `supabase/functions/` (4 files) — Edge Functions (Deno; transport-only, rules in src/lib). README.md, index.ts, index.ts, index.ts
- `scripts/` (33 files) — PIPELINE glue (stage 1-10) — not game code. _pipeline_lib.py, assemble_context.py, build_context_pack.py, build_outcome_record.py, build_review_packet.py, check_coverage_floor.py, check_diff_size.py, check_merge_eligibility.py … (+25)
- `.github/workflows/` (12 files) — PIPELINE workflows — human-owned, agents never edit. ci-pr-gates.yml, conflict-resolver.yml, onboarding-pack.yml, review-agent.yml, stage10-learn.yml, stage3-proposal.yml, stage3-respond.yml, stage5-implement.yml … (+4)
- `docs/agent/` (4 files) — Agent memory (this pack, CORRECTIONS.md). CORRECTIONS.md, CYJ-6-implementation-notes.md, onboarding-pack.md, pack-curated.md
- `agent/` (8 files) — Agent instruction prompts per stage. conflict-resolution-instructions.md, fix-instructions.md, implementation-instructions.md, proposal-instructions.md, proposal-template.md, review-functional.md, review-security.md, review-standards.md
- repo root — CLAUDE.md, eslint.config.js, fix-45-post-proposal-parse-diagnostics.sh, fix-46-block-requests-stage7-fix.sh, fix-47-pack-curated-drift.sh, index.html, package.json, repo-registry.yaml, tsconfig.json, vercel.json, vite.config.ts

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

### Migrations on disk (mechanical — regenerated every run; trust this over any prose above)
- `supabase/migrations/` — 2 file(s): `20261122000000_auth_users_sessions.sql`, `20261123000000_rooms.sql`

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

## 6. Gotchas (highest-value section)
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

## 7. Hotspots & ownership
App code (most-changed first, last 90d — high churn = review carefully, keep tests close):
- `src/screens/Lobby.tsx` — 10 commits
- `src/screens/Landing.tsx` — 9 commits
- `src/screens/Lobby.test.tsx` — 8 commits
- `supabase/functions/auth/index.ts` — 8 commits
- `src/screens/Landing.test.tsx` — 7 commits
- `src/lib/auth/flow.test.ts` — 6 commits
- `src/lib/auth/flow.ts` — 6 commits
- `src/auth/sessionClient.ts` — 5 commits
- `package.json` — 5 commits
- `src/App.render.test.tsx` — 4 commits
- `src/lib/auth/session.test.ts` — 4 commits
- `src/lib/auth/session.ts` — 4 commits
- `src/auth/sessionClient.test.ts` — 4 commits
- `src/screens/Landing.css` — 3 commits
- `src/screens/Lobby.css` — 3 commits

Pipeline infrastructure (churn here = pipeline debugging, not app risk):
- `.github/workflows/stage5-implement.yml` — 11 commits
- `.github/workflows/stage7-fix.yml` — 9 commits
- `.github/workflows/stage8b-qa-evidence.yml` — 9 commits
- `.github/workflows/ci-pr-gates.yml` — 8 commits
- `scripts/post_proposal.py` — 7 commits

Ownership: single service `idiom-game` (repo-registry.yaml), owner funcoin68, risk tier 3. `.github/workflows/` is human-owned — workflow diffs from an agent are auto-reverted.

## 8. Recent decisions (rolling, last 90 days, from git log)
- 2026-11-23 — CYJ-19: repair App SSR smoke test — Landing SSR renders the loading state
- 2026-11-23 — chore: regenerate onboarding pack (2026-11-23)
- 2026-11-23 — CYJ-19: session-aware Landing — welcome + Go to Lobby when signed in
- 2026-11-23 — agent: address review comments (round 1)
- 2026-11-23 — fix #46: changes-requested (block) verdict enters the stage-7 fix loop
- 2026-11-23 — CYJ-18: drop unused fetch-stub parameter (lint)
- 2026-11-23 — CYJ-18: import parseCookies in auth Edge Function
- 2026-11-23 — CYJ-18 checkpoint 1: failing regression test for parseCookies ReferenceError
- 2026-11-23 — fix-45: post_proposal parse diagnostics — no more bare tracebacks
- 2026-11-23 — chore: regenerate onboarding pack (2026-11-23)
- 2026-11-22 — fix-44: conflict-resolver — git identity on runner + MERGE_HEAD hardening
- 2026-11-22 — feat: conflict-resolver workflow — agent resolves agent/* PR merge conflicts
- 2026-11-23 — CYJ-17: flag-gated real create-room path in the Lobby
- 2026-11-23 — CYJ-17: rooms table, room-authority Edge Function, create-room decision layer
- 2026-11-23 — CYJ-16: remove flag-cyj-7 gate — Google sign-in live for all users
- 2026-11-23 — agent: address review comments (round 2)
- 2026-11-23 — agent: address review comments (round 1)
- 2026-11-23 — CYJ-15: fix /auth/me 401 after Google sign-in via x-cyj-session header transport
- 2026-11-23 — agent: address review comments (round 2)
- 2026-11-23 — agent: address review comments (round 2)

## 9. Open risks / known debt
- Persistence exists for AUTH only (users/sessions): game state is still
  mock fixtures; rooms/players/moves are not migrated; no Realtime —
  multi-player is not real yet.
- No room-authority function (turn order/scoring unenforced).
- Component tests are render-smoke only (App.render.test.tsx); coverage gate
  is effectively scoped to src/lib until screen interaction tests exist.
- docs/agent/CYJ-6-implementation-notes.md is a PR-body workaround artifact —
  delete once absorbed (see its own header).

---
## Verification
Before claiming a task done, the agent must have run: `npm test -- --run` and
`npm run lint` on its diff. Coverage gate input: `npm run coverage` (json-summary).
Stale-pack warning: if this file is older than 14 days relative to repo HEAD,
distrust section 8 and re-derive from git log.
