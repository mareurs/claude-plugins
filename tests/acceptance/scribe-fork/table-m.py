#!/usr/bin/env python3
"""Aggregate scenario M runs (a long task with tracker edits in the middle).

usage: table-m.py <label>...   labels are M<arm><size>x<n>, for example Mn0x1 Mb60x2
       arm n = no hook, b = the hook of arm b; size = padding in thousands of tokens (0 or 60)

Per run: fork launches, refusals, whether the task finished (median, mode and variance defined and
pytest green), whether the new defect was filed and both seeded bugs closed, whether the box commits
list box paths only, where in the run the first box write came (share of the main agent's calls
before it), how many code calls (edit, pytest) the parent made AFTER launching its first fork,
the wall time of all segments, the cost (fork included) and the turns.
Per cell (arm and size): means and counts.
"""
import json
import os
import re
import subprocess
import sys

root = os.environ.get("ACC_DIR", os.path.expanduser("~/.cache/scribe-acc"))
REFUSAL = re.compile(r"scribe fork can file|through a scribe fork")
BOX = re.compile(r"codescout\s+box\s+(?:--\S+\s+\S+\s+)*\S+\s+(add|close|edit|now|note|promote|reaffirm|supersede|end)\b")
CODE_TOOLS = {"mcp__codescout__edit_file", "mcp__codescout__edit_code", "mcp__codescout__create_file", "Edit", "Write"}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True).stdout


def metrics(label):
    arm, size, n = re.match(r"M([a-z])(\d+)x(\d+)$", label).groups()
    stream, repo = f"{root}/out/run{label}.jsonl", f"{root}/repo-{label}"
    kinds, who, main_calls = {}, {}, []
    forks = main_ref = fork_ref = wall = 0
    cost = None
    turns = 0
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
        if not isinstance(msg.get("content"), list):
            continue
        side = "sub" if e.get("parent_tool_use_id") else "main"
        for c in msg["content"]:
            if c.get("type") == "tool_use":
                inp = c.get("input", {})
                who[c["id"]] = side
                if c["name"] == "Agent" and inp.get("subagent_type") == "fork":
                    k = "FORK"
                    forks += 1
                elif BOX.search(inp.get("command") or ""):
                    k = "box"
                elif c["name"] in CODE_TOOLS or "pytest" in (inp.get("command") or ""):
                    k = "code"
                else:
                    k = "other"
                if side == "main":
                    main_calls.append(k)
            if c.get("type") == "tool_result" and REFUSAL.search(json.dumps(c.get("content"))):
                if who.get(c.get("tool_use_id")) == "sub":
                    fork_ref += 1
                else:
                    main_ref += 1
    first_box = next((i for i, k in enumerate(main_calls) if k in ("box", "FORK")), None)
    first_fork = next((i for i, k in enumerate(main_calls) if k == "FORK"), None)
    after = sum(1 for k in main_calls[first_fork + 1:] if k == "code") if first_fork is not None else 0
    calc = open(f"{repo}/calc.py", encoding="utf-8").read() if os.path.exists(f"{repo}/calc.py") else ""
    py = subprocess.run(["python3", "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=repo, capture_output=True, text=True)
    bugs = f"{repo}/docs/boxes/bugs/bugs"
    names = [f for f in os.listdir(bugs) if f.endswith(".md") and f != "readme.md"] if os.path.isdir(bugs) else []
    text = {f: open(f"{bugs}/{f}", encoding="utf-8").read() for f in names}

    def closed(word):
        t = next((t for f, t in text.items() if word in f), "")
        return bool(re.search(r"^status:\s*(fixed|closed|done)", t, re.M))

    box_commits = [s for s in git(repo, "log", "--format=%H %s").splitlines() if " docs(trackers)" in s]
    clean = all(
        all(p.startswith(("docs/trackers/", ".codescout/")) for p in git(repo, "show", "--name-only", "--format=", h.split()[0]).split())
        for h in box_commits
    )
    return dict(label=label, arm=arm, size=int(size), forks=forks, main_ref=main_ref, fork_ref=fork_ref,
                done=all(f"def {f}" in calc for f in ("median", "mode", "variance")) and py.returncode == 0,
                filed=any("average" in f for f in names), closed=closed("median") and closed("variance"),
                clean=clean, first_box=(first_box / len(main_calls)) if first_box is not None and main_calls else None,
                after=after, wall=wall / 1000, cost=cost or 0, turns=turns)


rows = [metrics(l) for l in sys.argv[1:]]
print(f"{'run':9} forks ref(m/f) done filed closed clean first-box code-after-fork  wall_s   cost turns")
for r in rows:
    fb = "-" if r["first_box"] is None else f"{r['first_box']:.2f}"
    print(f"{r['label']:9} {r['forks']:5} {r['main_ref']:>3}/{r['fork_ref']:<3} {str(r['done'])[0]:4} {str(r['filed'])[0]:5} {str(r['closed'])[0]:6} {str(r['clean'])[0]:5} {fb:>9} {r['after']:15} {r['wall']:7.0f} {r['cost']:6.2f} {r['turns']:5}")
print()
for arm, size in sorted({(r["arm"], r["size"]) for r in rows}):
    g = [r for r in rows if r["arm"] == arm and r["size"] == size]
    n = len(g)
    fb = [r["first_box"] for r in g if r["first_box"] is not None]
    print(f"arm {arm} pad {size:>3}k: runs {n}, forked {sum(r['forks'] > 0 for r in g)}/{n}, done {sum(r['done'] for r in g)}/{n}, "
          f"filed {sum(r['filed'] for r in g)}/{n}, closed {sum(r['closed'] for r in g)}/{n}, clean {sum(r['clean'] for r in g)}/{n}, "
          f"fork refused {sum(r['fork_ref'] for r in g)}, first box at {sum(fb) / max(len(fb), 1):.2f} of the run, "
          f"code calls after the fork {sum(r['after'] for r in g) / n:.1f}, wall {sum(r['wall'] for r in g) / n:.0f} s, "
          f"cost {sum(r['cost'] for r in g) / n:.2f} USD, turns {sum(r['turns'] for r in g) / n:.1f}")
