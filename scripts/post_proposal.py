"""Parse the agent's proposal output, post it to Jira, pin the comment id,
transition status, manage the agent-awaiting-human label, ping Slack.
Contract: proposal lives between ---PROPOSAL-START--- / ---PROPOSAL-END---
with YAML front matter. No prose outside markers (proposal-instructions.md).
Usage: post_proposal.py out.txt --ticket KEY --round N [--notify-slack CH]"""
import sys, os, re, json, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pipeline_lib import jira, jira_adf, sha256_text, _req

def parse_proposal(text):
    m = re.search(r"---PROPOSAL-START---(.*?)---PROPOSAL-END---", text, re.S)
    if not m: raise SystemExit("FATAL: no PROPOSAL markers in agent output")
    body = m.group(1).strip()
    fm = {}
    if body.startswith("---"):
        end = body.index("\n---", 3)
        import yaml
        fm = yaml.safe_load(body[3:end]) or {}
        body = body[end+4:].strip()
    return fm, body

def transition(issue_key, name):
    ts = jira("GET", f"/issue/{issue_key}/transitions")["transitions"]
    for t in ts:
        if t["name"].lower() == name.lower():
            jira("POST", f"/issue/{issue_key}/transitions", {"transition": {"id": t["id"]}})
            return True
    return False

def set_label(issue_key, label, on):
    op = "add" if on else "remove"
    jira("PUT", f"/issue/{issue_key}", {"update": {"labels": [{op: label}]}})

def main():
    out_file, args = sys.argv[1], sys.argv[2:]
    opt = {args[i]: args[i+1] for i in range(len(args)-1) if args[i].startswith("--")}
    key, rnd = opt["--ticket"], opt.get("--round", "0")
    fm, body = parse_proposal(open(out_file).read())

    posted = jira("POST", f"/issue/{key}/comment", {"body": jira_adf(body)})
    # THE PINNING CONTRACT (PDF stage 4): gate 1 carries proposal_comment_id
    jira("PUT", f"/issue/{key}/properties/last-proposal",
         {"comment_id": posted["id"], "hash": sha256_text(body), "round": rnd})

    blocked = bool(fm.get("open_questions"))
    if blocked and int(rnd) >= 3:
        transition(key, "Needs human refinement"); set_label(key, "agent-awaiting-human", False)
        print(f"round {rnd} still ambiguous -> Needs human refinement")
    elif blocked:
        transition(key, "Waiting on human input"); set_label(key, "agent-awaiting-human", True)
        print("open questions -> Waiting on human input (+agent-awaiting-human)")
    else:
        transition(key, "Proposal ready"); set_label(key, "agent-awaiting-human", True)
        print(f"proposal posted (comment {posted['id']}, tier {fm.get('risk_tier')}, "
              f"confidence {fm.get('confidence')}) -> Proposal ready")
    hook = os.environ.get("SLACK_WEBHOOK_URL")
    if hook and opt.get("--notify-slack"):
        _req("POST", hook, expect_json=False, body={"text": f"Proposal v{int(rnd)+1} for {key} "
            f"(tier {fm.get('risk_tier','?')}, confidence {fm.get('confidence','?')}): "
            f"{os.environ.get('JIRA_BASE_URL','')}/browse/{key}"})

if __name__ == "__main__":
    main()
