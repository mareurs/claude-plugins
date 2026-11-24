#!/usr/bin/env python3
"""Score one acceptance run of the scribe pattern.

usage: score.py <scenario><n>     e.g. score.py B2   (reads $ACC_DIR/out/run<..>.jsonl, repo $ACC_DIR/repo-<..>)

Prints the tool calls (main agent and subagents), the Agent launches, the final answer, the
last commits of the scratch repository with their paths, and the cost line. Pass or fail is the
operator's reading of this output against the rule in the spec:
  scenario B: one background fork in at least 2 of 3 runs, the task completes, the fork's
  commits list only box paths. Scenario A: the entry is filed either way.
"""
import json
import os
import subprocess
import sys

label = sys.argv[1]
root = os.environ.get("ACC_DIR", os.path.expanduser("~/.cache/scribe-acc"))
stream = f"{root}/out/run{label}.jsonl"
repo = f"{root}/repo-{label}"

calls, final, cost = [], "", None
for line in open(stream, encoding="utf-8"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("type") == "result":
        final = (e.get("result") or "")[:600]
        cost = (e.get("total_cost_usd"), e.get("num_turns"), e.get("duration_ms"))
    if e.get("type") != "assistant":
        continue
    who = "sub" if e.get("parent_tool_use_id") else "main"
    for c in e.get("message", {}).get("content", []):
        if c.get("type") == "tool_use":
            calls.append((who, c["name"], json.dumps(c.get("input", {}))[:150]))

forks = [c for c in calls if c[1] == "Agent" and '"fork"' in c[2]]
print(f"tool calls: {len(calls)} | fork launches: {len(forks)}")
for who, name, brief in calls:
    print(f"  [{who}] {name} {brief}")
print("FINAL:", final)
if cost:
    print("cost_usd=%s turns=%s duration_ms=%s" % cost)
git = lambda *a: subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout
print(git("log", "--stat", "--format=%h %s", "-5"))
print("uncommitted:", git("status", "--short").strip().replace("\n", " | "))
