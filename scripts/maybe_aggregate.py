"""Swarm aggregator. Runs at the end of EVERY reviewer run; exits unless all
three reviewed-* labels are present (fires exactly once, on the last reviewer).
Decision matrix (PDF stage 7/8):
  any persona missing            -> exit quietly (not my job yet)
  any 'block' or mixed verdicts  -> flag human, swarm stops
  any criticals                  -> dispatch stage7-fix round N+1 (N<3), else human
  all approve/comment, 0 crit    -> consensus-passed label + dispatch stage 8b
Usage: maybe_aggregate.py --pr 482 --ticket PROJ-123"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pipeline_lib import gh, pr_labels, add_label, pr_comment, dispatch

PERSONAS = ["functional", "security", "standards"]
MAX_FIX_ROUNDS = 3

def latest_verdicts(pr):
    """Newest verdict block per persona, parsed from PR review bodies."""
    verdicts = {}
    reviews = gh("GET", f"/pulls/{pr}/reviews?per_page=100")
    for r in reviews:
        m = re.search(r"---REVIEW-START---(.*?)---REVIEW-END---", r.get("body") or "", re.S)
        if not m: continue
        d = dict(line.split(":", 1) for line in
                 (l.strip() for l in m.group(1).strip().splitlines() if ":" in l))
        p = d.get("persona", "").strip()
        if p in PERSONAS: verdicts[p] = d   # later reviews overwrite = newest wins
    return verdicts

def decide(verdicts, fix_round):
    """Pure decision function — unit-tested. Returns (action, detail)."""
    if any(v.get("verdict", "").strip() == "block" for v in verdicts.values()):
        return "human", "a reviewer used veto (block)"
    vs = {p: v.get("verdict", "").strip() for p, v in verdicts.items()}
    total_crit = sum(int(v.get("criticals", "0") or 0) for v in verdicts.values())
    if total_crit > 0:
        if fix_round >= MAX_FIX_ROUNDS:
            return "human", f"criticals still open after {fix_round} fix rounds"
        return "fix", f"{total_crit} criticals -> fix round {fix_round + 1}"
    if all(x in ("approve", "comment") for x in vs.values()):
        return "consensus", "CI green + zero criticals + security pass"
    return "human", f"conflicting verdicts: {vs}"

def main():
    args = sys.argv[1:]
    pr_no, ticket = args[args.index("--pr")+1], args[args.index("--ticket")+1]
    labels = pr_labels(pr_no)
    if not all(f"reviewed-{p}" in labels for p in PERSONAS):
        print("not all reviewers in yet — exiting (aggregation fires on the last one)")
        return
    fix_round = len([l for l in labels if re.fullmatch(r"fix-round-\d+", l)])
    verdicts = latest_verdicts(pr_no)
    action, detail = decide(verdicts, fix_round)
    print(f"aggregation: {action} — {detail}")

    if action == "fix":
        add_label(pr_no, f"fix-round-{fix_round + 1}")
        dispatch("stage7-fix.yml", {"pr_number": pr_no, "ticket_key": ticket,
                                    "round": fix_round + 1})
    elif action == "consensus":
        add_label(pr_no, "consensus-passed")
        pr_comment(pr_no, f"**Consensus passed** (stage 8): {detail}. QA evidence bundle next.")
        dispatch("stage8b-qa-evidence.yml", {"pr_number": pr_no, "ticket_key": ticket})
    else:
        for p in PERSONAS: remove_label_safe(pr_no, f"reviewed-{p}")
        pr_comment(pr_no, f"**Swarm stopped — needs human**: {detail}. "
                          "Labels cleared; a human decides next step.")

def remove_label_safe(pr, label):
    from _pipeline_lib import remove_label
    remove_label(pr, label)

if __name__ == "__main__":
    main()
