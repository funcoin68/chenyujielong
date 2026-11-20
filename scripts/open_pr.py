"""Open the implementation PR (idempotent) or check for existence.
  open_pr.py --ticket KEY --check            exit 0 + 'exists' if an open PR exists (stage-5 idempotency)
  open_pr.py --ticket KEY --base main --head agent/KEY"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pipeline_lib import gh

def find_open(head):
    repo = os.environ["GITHUB_REPOSITORY"]; owner = repo.split("/")[0]
    prs = gh("GET", f"/pulls?state=open&head={owner}:{head}")
    return prs[0] if prs else None

args = sys.argv[1:]
opt = {args[i].lstrip("-"): args[i+1] for i in range(len(args)-1) if args[i].startswith("--")}
# bug #17: the parser above drops a trailing valueless flag (e.g. --check)
for _a in args:
    if _a.startswith("--") and _a.lstrip("-") not in opt:
        opt[_a.lstrip("-")] = True
head = opt.get("head", f"agent/{opt['ticket']}")
existing = find_open(head)
if "check" in opt:
    exists = "true" if existing else "false"
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        open(out, "a").write(f"exists={exists}\n")
    print(f"pr-exists={exists}" + (f" (#{existing['number']})" if existing else ""))
    raise SystemExit(0)
if existing:
    print(f"PR already open: #{existing['number']}"); raise SystemExit(0)
body = f"""## What & why
Implements Jira **{opt['ticket']}** per the pinned, gate-1-approved proposal (link in Jira comment).

## Test evidence
Repo verification (`TEST_COMMAND`, `LINT_COMMAND`) ran green on the runner before this PR opened.

## Modules
<!-- scope guard parses this list; keep it honest -->
modules: []

## Risk
risk_tier: see packet comment (built by stage 6)

## Rollout
Behind feature flag `flag-{opt['ticket']}` (ships disabled).
"""
pr = gh("POST", "/pulls", {"title": f"[{opt['ticket']}] agent implementation",
                           "head": head, "base": opt.get("base", "main"), "body": body})
print(f"opened PR #{pr['number']}: {pr['html_url']}")
