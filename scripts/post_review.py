"""Parse a reviewer run's stdout: verdict block + comments JSON fence; post as a
GitHub PR review with inline comments; add the reviewed-<persona> label.
Usage: post_review.py --pr 482 --persona functional --output-file /tmp/review_out.txt"""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pipeline_lib import gh, add_label, get_pr

def parse_review_output(text):
    """Extract verdict block and comments JSON from agent stdout."""
    vm = re.search(r"---REVIEW-START---(.*?)---REVIEW-END---", text, re.S)
    if not vm: raise SystemExit("FATAL: reviewer produced no verdict block")
    verdict = {}
    for line in vm.group(1).strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1); verdict[k.strip()] = v.strip()
    cm = re.search(r"```json\s*(\[.*?\])\s*```", text, re.S)
    comments = json.loads(cm.group(1)) if cm else []
    return verdict, comments

def main():
    args = sys.argv[1:]
    pr_no = args[args.index("--pr")+1]; persona = args[args.index("--persona")+1]
    text = open(args[args.index("--output-file")+1]).read()
    verdict, comments = parse_review_output(text)

    v = verdict.get("verdict", "comment").lower()
    crit = int(verdict.get("criticals", "0") or 0)
    event = {"approve": "APPROVE", "comment": "COMMENT"}.get(v, "REQUEST_CHANGES")
    if v == "block": event = "REQUEST_CHANGES"

    # inline comments: criticals become review comments; needs-human-eye flagged
    gh_comments = []
    for c in comments[:50]:   # safety bound
        body = c["body"]
        if c.get("severity") == "critical" and c.get("confidence") != "high":
            body = "**[needs-human-eye]** " + body
        gh_comments.append({"path": c["file"], "line": int(c.get("line", 1)),
                            "side": "RIGHT", "body": f"[{c.get('severity','comment')}] {body}"})
    head_sha = get_pr(pr_no)["head"]["sha"]
    body = (f"### Review — {persona} (clean-room, k3-256k)\n"
            f"```\n---REVIEW-START---\npersona: {persona}\nverdict: {v}\n"
            f"criticals: {crit}\ncomments: {len(comments)}\n---REVIEW-END---\n```")
    payload = {"commit_id": head_sha, "event": event, "body": body}
    if gh_comments: payload["comments"] = gh_comments
    try:
        gh("POST", f"/pulls/{pr_no}/reviews", payload)
    except SystemExit:   # inline anchors can fail on outdated diffs; fall back to summary review
        payload.pop("comments", None)
        body += "\n\n" + "\n".join(f"- `{c['file']}:{c.get('line','?')}` "
                f"[{c.get('severity')}] {c['body']}" for c in comments)
        payload["body"] = body
        gh("POST", f"/pulls/{pr_no}/reviews", payload)
    add_label(pr_no, f"reviewed-{persona}")
    print(f"review posted: {persona} verdict={v} criticals={crit}; label reviewed-{persona}")

if __name__ == "__main__":
    main()
