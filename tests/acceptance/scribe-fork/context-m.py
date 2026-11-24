#!/usr/bin/env python3
"""What the parent's own context carried about boxes, for scenario M runs.

usage: context-m.py <label>...    labels are M<arm><size>x<n> as in table-m.py

Main thread only: the fork's own calls are not the parent's context. Prints, per cell (arm and size),
the means over its runs of: all calls, box-related calls, the bytes the parent read back from those
calls, cache tokens; then the box-related calls by kind (help, read, write attempts, get_guide, tracker files).
Write attempts include the refused ones: the refusal is in the parent's context as well.
"""
import collections
import json
import os
import re
import sys

root = os.path.expanduser(os.environ.get("ACC_DIR", "~/.cache/scribe-acc")) + "/out"
BOXRE = re.compile(r"codescout\s+box|get_guide|tracker-conventions|docs/trackers")
WRITE = re.compile(r"codescout\s+box\s+(?:--\S+\s+\S+\s+)*\S+\s+(add|close|edit|now|note|promote|reaffirm|supersede|end)\b")


def kind(name, inp):
    cmd = inp.get("command") or ""
    if name == "mcp__codescout__get_guide":
        return "get_guide(" + str(inp.get("topic")) + ")"
    if re.search(r"codescout\s+box\b.*\bhelp\b|codescout\s+box\s+--help|codescout\s+box\b.*\s--help", cmd):
        return "box help"
    if WRITE.search(cmd):
        return "box write attempt"
    if re.search(r"codescout\s+box", cmd):
        return "box read (list/show/find/...)"
    if re.search(r"docs/trackers", json.dumps(inp)):
        return "read of a docs/trackers file"
    return None


def analyse(label):
    boxy, res, usage, seen, kinds = set(), 0, collections.Counter(), set(), collections.Counter()
    calls = box = 0
    for line in open(f"{root}/run{label}.jsonl", encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") not in ("assistant", "user") or e.get("parent_tool_use_id"):
            continue
        msg = e.get("message", {})
        content = msg.get("content") if isinstance(msg.get("content"), list) else []
        if e.get("type") == "assistant":
            if msg.get("id") not in seen:
                seen.add(msg.get("id"))
                u = msg.get("usage", {})
                usage["cr"] += u.get("cache_read_input_tokens", 0)
                usage["cw"] += u.get("cache_creation_input_tokens", 0)
            for c in content:
                if c.get("type") == "tool_use":
                    calls += 1
                    if c["name"] != "Agent" and BOXRE.search(json.dumps(c.get("input", {})) + c["name"]):
                        boxy.add(c["id"])
                        box += 1
                        k = kind(c["name"], c.get("input", {}))
                        if k:
                            kinds[k] += 1
        else:
            for c in content:
                if c.get("type") == "tool_result" and c.get("tool_use_id") in boxy:
                    res += len(json.dumps(c.get("content")))
    return dict(calls=calls, box=box, res=res, cr=usage["cr"], cw=usage["cw"], kinds=kinds)


cells = collections.defaultdict(list)
for label in sys.argv[1:]:
    m = re.match(r"[ML]([a-z])(\d+)x\d+$", label)
    cells[(m.group(1), int(m.group(2)))].append(analyse(label))
order = sorted(cells, key=lambda c: (c[1], c[0]))
print(f"{'cell':11} {'runs':>4} {'calls':>6} {'box calls':>10} {'box result bytes':>17} {'cache-read tok':>15} {'cache-write tok':>16}")
for c in order:
    g = cells[c]
    mean = lambda k: sum(r[k] for r in g) / len(g)
    print(f"{c[0]} pad {c[1]:>2}k {len(g):>4} {mean('calls'):6.1f} {mean('box'):10.1f} {mean('res'):17.0f} {mean('cr'):15.0f} {mean('cw'):16.0f}")
print()
names = sorted({k for c in order for r in cells[c] for k in r["kinds"]})
print(f"{'box-related main-thread call (mean per run)':46}" + "".join(f"{c[0]} {c[1]:>2}k   " for c in order))
for k in names:
    print(f"{k:46}" + "".join(f"{sum(r['kinds'][k] for r in cells[c]) / len(cells[c]):7.1f}  " for c in order))
