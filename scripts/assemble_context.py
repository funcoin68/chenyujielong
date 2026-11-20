"""Merge ticket + onboarding pack + CORRECTIONS.md + repo registry into one
context doc for the agent. Enforces the 40k-char pack budget (PDF: pack <40k
chars, staleness 14 days warning).
Usage: assemble_context.py ticket.json [--with-qa] > context.md"""
import sys, os, json, re, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BUDGET = 40000

def read(path, label):
    if not os.path.exists(path):
        return f"## {label}\n(not present in repo yet — first-run repo)\n"
    return f"## {label}\n" + open(path).read()

def main():
    ticket = json.load(open(sys.argv[1]))
    with_qa = "--with-qa" in sys.argv
    parts = [f"# Ticket {ticket['key']}: {ticket.get('summary')}",
             f"Status: {ticket.get('status')}  Labels: {', '.join(ticket.get('labels', []))}"]
    ac = ticket.get("acceptance_criteria") or []
    parts.append("## Acceptance criteria (verbatim)")
    parts += [f"- {a}" for a in ac] if ac else ["(NONE — missing AC is a stage-1 rejection; escalate, do not guess)"]
    # staleness warning on the pack (PDF: 14 days)
    pack = "docs/agent/onboarding-pack.md"
    if os.path.exists(pack):
        m = re.search(r"generated: ([0-9-]+)", open(pack).read())
        if m:
            age = (datetime.date.today() - datetime.date.fromisoformat(m.group(1))).days
            if age > 14:
                parts.append(f"> WARNING: onboarding pack is {age} days old (>14). "
                             "Distrust 'recent decisions'; re-derive from git log.")
    parts.append(read(pack, "Onboarding pack"))
    parts.append(read("docs/agent/CORRECTIONS.md", "CORRECTIONS.md (prior-engineer memory)"))
    if os.path.exists("repo-registry.yaml"):
        parts.append(read("repo-registry.yaml", "Repo registry (scope + risk tiers)"))
    if with_qa and ticket.get("comments"):
        parts.append("## Q&A transcript since proposal")
        for c in ticket["comments"]:
            parts.append(f"- **{c['author']}** ({c['created']}): comment {c['id']}")
    out = "\n\n".join(parts)
    if len(out) > BUDGET:
        out = out[:BUDGET] + "\n\n[TRUNCATED at 40k-char pack budget — narrow the ticket scope]"
    print(out)

if __name__ == "__main__":
    main()
