#!/usr/bin/env python3
"""Analysis of the hold-ack probe, by the rules in PREREG.md."""
import json, os, sys, glob, re

AP = sys.argv[1]
rows = []
for d in sorted(glob.glob(os.path.join(AP, sys.argv[2] if len(sys.argv) > 2 else "runs", "*-[SMF]-[123]"))):
    name = os.path.basename(d)
    arm, task, n = name.split("-")
    calls = []          # (name, bytes, is_box_add)
    out_by_msg = {}
    result_out = None
    for line in open(os.path.join(d, "stream.jsonl")):
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("type") == "result":
            result_out = ev["usage"]["output_tokens"]
        if ev.get("type") != "assistant":
            continue
        m = ev["message"]
        if m.get("usage") and "output_tokens" in m["usage"]:
            out_by_msg[m["id"]] = m["usage"]["output_tokens"]
        for c in m.get("content", []):
            if c.get("type") == "tool_use":
                cmd = (c.get("input") or {}).get("command", "") if c["name"] == "Bash" else ""
                calls.append((c["name"], len(json.dumps(c.get("input"))), "./boxw add" in cmd))
    seq = [("boxw" if b else nm) for nm, _, b in calls]
    # the first refusal is the first boxw add call; the choice is the next call after it
    first = next((i for i, s in enumerate(seq) if s == "boxw"), None)
    nxt = seq[first + 1] if first is not None and first + 1 < len(seq) else None
    kind = {"boxw": "REPEAT", "mcp__hold-ack-probe__ack": "ACK", "Task": "DELEGATE", "Agent": "DELEGATE"}.get(nxt, "OTHER" if nxt else "NONE")
    inline_adds = sum(1 for s in seq if s == "boxw")
    delegated = any(s in ("Task", "Agent") for s in seq)
    # M: DELEGATE before the third inline add
    third = [i for i, s in enumerate(seq) if s == "boxw"]
    deleg_idx = next((i for i, s in enumerate(seq) if s in ("Task", "Agent")), None)
    if task == "S":
        correct = (not delegated) and os.path.exists(os.path.join(d, "notes.tsv"))
    else:
        correct = deleg_idx is not None and (len(third) < 3 or deleg_idx < third[2])
    notes = 0
    p = os.path.join(d, "notes.tsv")
    if os.path.exists(p):
        notes = sum(1 for _ in open(p))
    box_bytes = sum(b for nm, b, isb in calls if isb)
    rows.append(dict(run=name, arm=arm, task=task, n=int(n), seq=" > ".join(seq), choice=kind, correct=correct,
                     inline_adds=inline_adds, notes=notes, out=result_out, box_bytes=box_bytes))

print(f"{'run':11} {'choice':9} {'ok':3} {'adds':4} {'notes':5} {'out_tok':7} {'boxw_bytes':10}  sequence")
for r in rows:
    print(f"{r['run']:11} {r['choice']:9} {'yes' if r['correct'] else 'NO':3} {r['inline_adds']:4} {r['notes']:5} {r['out']:7} {r['box_bytes']:10}  {r['seq']}")
print()
for task in ("S", "M", "F"):
    for arm in ("repeat", "hold"):
        rs = [r for r in rows if r["task"] == task and r["arm"] == arm]
        if not rs:
            continue
        ch = {}
        for r in rs:
            ch[r["choice"]] = ch.get(r["choice"], 0) + 1
        print(f"{task} {arm:6}  correct {sum(r['correct'] for r in rs)}/{len(rs)}  choices {ch}  "
              f"mean out_tok(result) {sum(r['out'] for r in rs)/len(rs):.0f}  mean boxw_bytes {sum(r['box_bytes'] for r in rs)/len(rs):.0f}  "
              f"mean notes {sum(r['notes'] for r in rs)/len(rs):.1f}")
