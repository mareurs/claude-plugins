#!/usr/bin/env python3
"""One row per acceptance run, and a summary per arm.

usage: table.py <label>...      labels are <scenario><arm><n>, for example Ba1 Bb1 Bc1 Ba2 ...
       (run.sh <scenario> <arm><n> writes them; the arm is the second character)

Per run: fork launches, main-agent refusals, refusals of the fork's own calls (must be 0), whether
the task finished (median() in calc.py and pytest green), whether the new defect was filed, whether
the bug the change fixes was closed, whether every box commit lists box paths only, cost, turns.
"""
import json
import os
import re
import subprocess
import sys

root = os.environ.get("ACC_DIR", os.path.expanduser("~/.cache/scribe-acc"))
REFUSAL = re.compile(r"scribe fork can file|through a scribe fork")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True).stdout


def metrics(label):
    stream, repo = f"{root}/out/run{label}.jsonl", f"{root}/repo-{label}"
    who, forks, main_ref, fork_ref, cost, turns = {}, 0, 0, 0, None, None
    for line in open(stream, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "result":
            cost, turns = e.get("total_cost_usd"), e.get("num_turns")
        msg = e.get("message", {})
        if not isinstance(msg.get("content"), list):
            continue
        side = "sub" if e.get("parent_tool_use_id") else "main"
        for c in msg["content"]:
            if c.get("type") == "tool_use":
                who[c["id"]] = side
                if c["name"] == "Agent" and c.get("input", {}).get("subagent_type") == "fork":
                    forks += 1
            if c.get("type") == "tool_result" and REFUSAL.search(json.dumps(c.get("content"))):
                if who.get(c.get("tool_use_id")) == "sub":
                    fork_ref += 1
                else:
                    main_ref += 1
    calc = open(f"{repo}/calc.py", encoding="utf-8").read() if os.path.exists(f"{repo}/calc.py") else ""
    py = subprocess.run(["python3", "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=repo, capture_output=True, text=True)
    bugs = f"{repo}/docs/trackers/ledgers/bugs"
    entries = [f for f in os.listdir(bugs) if f.endswith(".md") and f != "readme.md"] if os.path.isdir(bugs) else []
    text = {f: open(f"{bugs}/{f}", encoding="utf-8").read() for f in entries}
    median = next((t for f, t in text.items() if "median" in f), "")
    filed = any("average" in f for f in entries)
    closed = bool(re.search(r"^status:\s*(fixed|closed|done)", median, re.M))
    box_commits = [s for s in git(repo, "log", "--format=%H %s").splitlines() if " docs(trackers)" in s]
    clean = all(
        all(p.startswith(("docs/trackers/", ".codescout/")) for p in git(repo, "show", "--name-only", "--format=", h.split()[0]).split())
        for h in box_commits
    )
    return dict(label=label, forks=forks, main_ref=main_ref, fork_ref=fork_ref,
                done=("def median" in calc and py.returncode == 0), filed=filed, closed=closed,
                clean=clean, cost=cost, turns=turns)


rows = [metrics(l) for l in sys.argv[1:]]
print(f"{'run':6} forks refused(main/fork) task-done defect-filed bug-closed box-commits-clean   cost turns")
for r in rows:
    print(f"{r['label']:6} {r['forks']:5} {r['main_ref']:>7}/{r['fork_ref']:<6} {str(r['done']):9} {str(r['filed']):12} {str(r['closed']):10} {str(r['clean']):18} {r['cost'] or 0:6.2f} {r['turns']}")
print()
for arm in sorted({r["label"][1] for r in rows}):
    g = [r for r in rows if r["label"][1] == arm]
    n = len(g)
    print(f"arm {arm}: runs {n}, forked {sum(r['forks'] > 0 for r in g)}/{n}, task done {sum(r['done'] for r in g)}/{n}, "
          f"defect filed {sum(r['filed'] for r in g)}/{n}, bug closed {sum(r['closed'] for r in g)}/{n}, "
          f"commits clean {sum(r['clean'] for r in g)}/{n}, fork refused {sum(r['fork_ref'] for r in g)}, "
          f"mean cost {sum(r['cost'] or 0 for r in g) / n:.2f} USD, mean turns {sum(r['turns'] or 0 for r in g) / n:.1f}")
