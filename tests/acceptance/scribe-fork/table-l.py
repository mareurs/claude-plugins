#!/usr/bin/env python3
"""Aggregate scenario L runs (a long task with a large tracker job in the middle).

usage: table-l.py <label>...   labels are L<arm><size>x<n>, for example Ln0x1 Lf0x2
       arm n = the agent triages the ten bugs itself, f = the prompt hands the triage to a fork

Per run: fork launches, whether the task finished (median, mode, variance defined and pytest green),
how many of the ten bugs got a severity and a triage note, whether the box commits list box paths
only, the parent's code calls after its first fork, the wall time of all segments, the cost (fork
included), the turns. Per cell: means and counts.
"""
import json
import os
import re
import subprocess
import sys

root = os.environ.get("ACC_DIR", os.path.expanduser("~/.cache/scribe-acc"))
BOX = re.compile(r"codescout\s+box\s+(?:--\S+\s+\S+\s+)*\S+\s+(add|close|edit|now|note|promote|reaffirm|supersede|end)\b")
CODE_TOOLS = {"mcp__codescout__edit_file", "mcp__codescout__edit_code", "mcp__codescout__create_file", "Edit", "Write"}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True).stdout


def metrics(label):
    arm, size, n = re.match(r"L([a-z])(\d+)x(\d+)$", label).groups()
    stream, repo = f"{root}/out/run{label}.jsonl", f"{root}/repo-{label}"
    main_calls, forks, wall, turns, cost = [], 0, 0, 0, None
    for line in open(stream, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "result":
            cost = e.get("total_cost_usd")
            turns += e.get("num_turns") or 0
            wall += e.get("duration_ms") or 0
        msg = e.get("message", {})
        if not isinstance(msg.get("content"), list) or e.get("parent_tool_use_id"):
            continue
        for c in msg["content"]:
            if c.get("type") != "tool_use":
                continue
            inp = c.get("input", {})
            if c["name"] == "Agent" and inp.get("subagent_type") == "fork":
                k, forks = "FORK", forks + 1
            elif BOX.search(inp.get("command") or ""):
                k = "box"
            elif c["name"] in CODE_TOOLS or "pytest" in (inp.get("command") or ""):
                k = "code"
            else:
                k = "other"
            main_calls.append(k)
    first_fork = next((i for i, k in enumerate(main_calls) if k == "FORK"), None)
    after = sum(1 for k in main_calls[first_fork + 1:] if k == "code") if first_fork is not None else 0
    calc = open(f"{repo}/calc.py", encoding="utf-8").read() if os.path.exists(f"{repo}/calc.py") else ""
    py = subprocess.run(["python3", "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=repo, capture_output=True, text=True)
    bugs = f"{repo}/docs/trackers/ledgers/bugs"
    names = [f for f in os.listdir(bugs) if f.endswith(".md") and f != "readme.md"] if os.path.isdir(bugs) else []
    texts = [open(f"{bugs}/{f}", encoding="utf-8").read() for f in names]
    severity = sum(1 for t in texts if re.search(r"^severity:\s*(low|medium|high)\s*$", t, re.M))
    noted = sum(1 for t in texts if re.search(r"^##\s+Now\s*\n+\S", t, re.M))
    box_commits = [s for s in git(repo, "log", "--format=%H %s").splitlines() if " docs(trackers)" in s]
    clean = all(
        all(p.startswith(("docs/trackers/", ".codescout/")) for p in git(repo, "show", "--name-only", "--format=", h.split()[0]).split())
        for h in box_commits
    )
    return dict(label=label, arm=arm, size=int(size), forks=forks, severity=severity, noted=noted, entries=len(names),
                done=all(f"def {f}" in calc for f in ("median", "mode", "variance")) and py.returncode == 0,
                clean=clean, after=after, wall=wall / 1000, cost=cost or 0, turns=turns)


rows = [metrics(l) for l in sys.argv[1:]]
print(f"{'run':9} forks done severity noted entries clean code-after-fork  wall_s   cost turns")
for r in rows:
    print(f"{r['label']:9} {r['forks']:5} {str(r['done'])[0]:4} {r['severity']:8} {r['noted']:5} {r['entries']:7} {str(r['clean'])[0]:5} {r['after']:15} {r['wall']:7.0f} {r['cost']:6.2f} {r['turns']:5}")
print()
for arm, size in sorted({(r["arm"], r["size"]) for r in rows}):
    g = [r for r in rows if r["arm"] == arm and r["size"] == size]
    n = len(g)
    print(f"arm {arm} pad {size:>3}k: runs {n}, forked {sum(r['forks'] > 0 for r in g)}/{n}, done {sum(r['done'] for r in g)}/{n}, "
          f"severity set {sum(r['severity'] for r in g) / n:.1f}/{sum(r['entries'] for r in g) / n:.1f}, noted {sum(r['noted'] for r in g) / n:.1f}/{sum(r['entries'] for r in g) / n:.1f}, clean {sum(r['clean'] for r in g)}/{n}, "
          f"code calls after the fork {sum(r['after'] for r in g) / n:.1f}, wall {sum(r['wall'] for r in g) / n:.0f} s "
          f"(min {min(r['wall'] for r in g):.0f}, max {max(r['wall'] for r in g):.0f}), cost {sum(r['cost'] for r in g) / n:.2f} USD, turns {sum(r['turns'] for r in g) / n:.1f}")
