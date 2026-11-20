"""Scope guard: agent may only touch modules its PR body declared (stage 5
output contract: 'modules:' list). Stray paths fail the gate.
Usage: check_scope.py --pr 482 [--base origin/main]"""
import sys, os, re, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pipeline_lib import get_pr

args = sys.argv[1:]
pr_no = args[args.index("--pr")+1]
base = args[args.index("--base")+1] if "--base" in args else "origin/main"
body = get_pr(pr_no).get("body") or ""
m = re.search(r"^modules:\s*(.+)$", body, re.M)
if not m or not m.group(1).strip() or m.group(1).strip() == "[]":
    raise SystemExit("FAIL: PR body has no 'modules:' declaration — the scope guard "
                     "cannot verify scope. Stage-5 contract requires it.")
declared = [x.strip().strip('"\'') for x in m.group(1).strip("[]").split(",") if x.strip()]
out = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"],
                     capture_output=True, text=True, check=True).stdout
changed = [l for l in out.strip().splitlines() if l]
ALWAYS_OK = re.compile(r"^(\.github/workflows/|docs/agent/|CLAUDE\.md$|repo-registry\.yaml$)")
strays = [p for p in changed
          if not any(d and p.startswith(d) for d in declared) and not ALWAYS_OK.match(p)]
print(f"declared modules: {declared}\nchanged files: {len(changed)}")
if strays:
    print("FAIL: scope creep — files outside declared modules:\n  " + "\n  ".join(strays))
    raise SystemExit(1)
print("scope OK")
