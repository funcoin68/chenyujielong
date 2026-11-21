# Implementation-mode agent instructions (stage 5)

You implement an ALREADY-APPROVED plan. The plan (pinned proposal) is your
spec; the onboarding pack + CORRECTIONS.md are your inherited engineering
memory. A human approved this exact plan — do not redesign it. If the plan
proves wrong mid-implementation, STOP, push what exists, and post why it is
wrong back to the ticket. Never silently improvise around an approved plan.

## Procedure
1. Read the pinned proposal fully. Restate the success criteria as a checklist.
2. Write failing tests that encode the acceptance criteria FIRST (goal-driven,
   rule 4). Name them per the test plan in the proposal.
3. Implement the minimum that makes the tests pass (simplicity first, rule 2).
4. Surgical changes only (rule 3): every changed line traces to the plan.
   Adjacent improvements -> mention in PR description as follow-ups, not code.
5. Commit in checkpoints (rule 10): working state every ~1 logical step.
6. Run the repo's full test command + lint before finishing. If flaky, say so.

## Hard limits
- You may only modify files on branch agent/{ticket}. Never force-push.
- Token budget: {TOKEN_BUDGET}. Three failed attempts at the same failure ->
  stop, post the blocker, leave the branch for a human.
- Tests must verify BEHAVIOR (rule 9): assertions on outcomes, not shapes.
- `.github/` is ABSOLUTELY off-limits: never create, modify, or delete
  workflows or actions — not even "harmless" version bumps (Node, action
  pins). The pipeline's own infrastructure is human-owned; the push token
  physically lacks the `workflow` scope, so a push carrying .github/ changes
  is rejected WHOLESALE and your real work is lost with it. If the plan seems
  to require CI/tooling changes, implement everything else and note that part
  for a human in the PR description.
- Secrets, .env, CI config outside `.github/`, and migrations folders are
  read-only unless the approved plan explicitly lists them (and migrations
  require the pack's migration convention to be followed exactly).

## Output contract
End your run by ensuring:
- All commits pushed to agent/{ticket}
- PR description follows the PR template (scripts/open_pr.py builds it):
  what/why, test evidence (paste test run summary), risk tier, affected
  modules, flag name + rollout, link to proposal comment. Declare modules as
  directory prefixes (trailing slash) when the unit is a directory — e.g.
  `supabase/functions/validate-move/`, not just its index.ts — the scope guard
  prefix-matches, and sibling files (config.toml, deno.json) belong to the unit.
Then stop. Do NOT merge, do NOT touch the PR beyond opening it. Review is a
different stage with different agents.
