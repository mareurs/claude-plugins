---
id: '720408ecd2391251'
kind: tracker
status: active
title: Prompt Hamsa — Audit & Self-Reflection Log
owners:
- prompt-hamsa
tags:
- prompt-hamsa
- buddy
- audit-log
- self-reflection
- eval
topic: null
time_scope: null
---

# Prompt Hamsa — Audit & Self-Reflection Log

Every prompt-audit the Prompt Hamsa performs appends one row to `params.audits`.
The point is **measurement**: each row carries a falsifiable `prediction` and a
later-filled `outcome`, so the Hamsa's recommendations can be scored over time.
This is how *"unverified, N=0"* stops being a permanent flag and becomes a hold-rate.

## Scope

- **Project rows** — audits of prompts living in a specific repo → that repo's own
  `prompt-hamsa-audit-log` tracker.
- **Craft / global rows** — reflections about the craft of prompting itself, not tied
  to one repo → this tracker (`claude-plugins` is the Hamsa's home repo). Ambiguous → project.

## Row schema

| field | meaning |
|---|---|
| `date` | YYYY-MM-DD of the audit |
| `artifact` | the prompt audited — path, paste id, or `"drafting"` |
| `symptom` | observable failure, or the requested behavior |
| `gap` | the read-as-stranger gap the audit named |
| `move` | the one recommended next move |
| `prediction` | what the move should change — **the falsifiable core** |
| `eval_status` | `present(n=N)` / `drafted` / `absent` |
| `confidence` | `high` / `medium` / `low` |
| `outcome` | filled later: `held` / `partial` / `failed` / `unobserved` — **the measurement** |

## How to maintain

- **Record** (after every audit): read the current `audits` array, append the new row,
  write the full array back — `artifact_augment(id=<this>, merge=true, params={audits:[…all…]})`.
  Append only; never delete a row.
- **Fill an outcome later:** when evidence arrives, re-write the array with that row's
  `outcome` set (match on `date` + `artifact`).
- **Measure:** `artifact(action="get", id=<this>, entry_filter={"confidence":{"eq":"high"}})`;
  hold-rate = `held` ÷ (high-confidence rows with a non-empty `outcome`).

## History

### 2026-06-13 — created

Bootstrapped during the Hamsa self-improvement work (done-state + measurement loop).
Zero rows at birth; the first real audit seeds row 1.
