# CYJ-6 — Implementation notes (stage-5 agent)

This file exists because the pipeline-generated PR body (`scripts/open_pr.py`)
is a fixed skeleton the agent cannot edit at runtime (no GH_TOKEN in the agent
sandbox; the push token only reaches the workflow's own steps). Paste the
sections below into the PR body when opening/editing it. It is committed by
the stage-5 workflow's "Push branch + open PR" step, so it also lands in the
PR diff for reviewers. Delete it once its content is absorbed into the PR body.

## What & why

Implements Jira **CYJ-6** per the pinned, gate-1-approved proposal (Jira
comment): the full mock-up UI for 成语接龙 from the attached design spec —
all screens (S1 Landing + S1a How-to-Play sheet, S2 Lobby + S3/S4 modals,
S5 Waiting Room, S6 Gameplay, S7 Results, S8 Profile) at the spec §3 routes,
rendered entirely from `src/mock/data.ts` fixtures. No Supabase, no auth, no
network calls (AC #2).

## Suggested `modules:` line for the PR body (scope guard prefix-matches)

modules: [src/, index.html, package.json, package-lock.json]

## Test evidence

- `npm test -- --run` — 5 files, 34/34 tests pass:
  - `tokens.test.ts` (9) — spec §2.2 tokens + OKLCH pairing, WCAG contrast
    (ink ≥4.5:1, all 6 player colors ≥3:1 vs canvas), CJK fallback stack,
    `prefers-reduced-motion` block.
  - `App.render.test.tsx` (12) — `renderToString` of every route: renders
    without throwing (AC #3), `<main>` landmark, labelled icon buttons,
    gameplay prompt character derived from the fixture chain via `lastChar()`
    (not hardcoded), results show all fixture standings.
  - `Modal.test.tsx` (3) — `role="dialog"`, `aria-modal`, accessible name,
    real `<button>` close control (AC #4).
- `npm run lint` — clean.
- `npm run build` (`tsc -b && vite build`) — clean.
- `vite preview` smoke: all six routes return HTTP 200.
- eliminate error TS2493: Tuple type ‘[]’ of length ‘0’ has no element at index ‘0’.

Runtime-only behaviors (Esc close, focus return, shake animation, rAF timer)
are not covered by unit tests — Vitest runs in `node` env with no jsdom, and
adding jsdom/testing-library for a mock-up was explicitly rejected in the
approved plan. Verify by eyeball on the Vercel preview.

## Deviations from the design spec (AC #1)

1. **Player identity colors P2/P3/P4/P6 darkened.** Spec §2.2 requires all six
   at ≥3:1 contrast vs `bg-canvas`, but its sample hexes measure below that
   (P4 yellow 1.60:1, P6 pink 2.40:1, P3 green 2.46:1, P2 blue 2.93:1).
   Shipped tokens keep the same hues at passing values (P1/P5 unchanged as
   specced). Enforced by `tokens.test.ts`.
2. **CYJ-5 gradient background removed.** Spec §2.2 mandates a flat warm-paper
   canvas on all screens; the plan flagged this conflict and the gradient lost.
   `gradient.test.ts` was replaced by `tokens.test.ts`, which carries its
   contrast check forward stricter.
3. **Mock SSO.** "Sign in with Google" navigates straight to `/lobby`; sign-out
   returns to `/`. Real Google OAuth + the `?next=` deep-link return flow need
   the auth backend — follow-up ticket (plan §7).
4. **Mock gameplay.** Submit accepts any 4-character entry starting with the
   locked character (no dictionary); turns never pass to other players; timer
   counts down once from 23s and stops. Server-authoritative validation stays
   in the `validate-move` Edge Function, untouched.
5. **Waiting room renders the host view** with Ken not-ready, so START GAME is
   disabled with the spec's "Waiting for Ken…" tooltip. The non-host
   "I'm Ready" variant is not rendered. Gameplay remains reachable via the
   landing page's "peek as guest" link and the deep link `/room/demo/play`.
6. **No canvas confetti on Results** (spec S7) — static podium only; skipped
   as a v1-mock simplification.
7. **Copy deck inline, not in `copy.zh.json`/`copy.en.json`** (spec §9) —
   bilingual file split deferred with the full i18n pass.
8. **Google Fonts via `<link>` tags** (spec §2.3 sanctions this). Render never
   depends on them: `font-display: swap` + full system-CJK fallback stack on
   every CJK element, so AC #3 holds offline.
9. **Chat panel / quick-chat bubbles, reconnect banner, skeletons, toasts**
   (S5/S6/S9) are not mocked beyond their entry points (buttons exist and are
   labelled). Spec marks sound (§2.6) optional for v1; not implemented.

## Risk

risk_tier: 3 (per repo-registry.yaml — practice repo, pre-launch; no
production behavior exists to protect)

## Rollout

behind_feature_flag: false — deliberate per approved plan §6: the entire app
is the mock-up; rollback is reverting this single PR. Vercel preview on the PR
is the AC's "viewable mock-up" check.
