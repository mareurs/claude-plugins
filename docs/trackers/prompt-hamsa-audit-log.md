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

### 2026-06-14 — full-fleet buddy audit + Snow Leopard A/B pilot

**Audit (7 rows added).** All 13 buddy specialists reviewed as prompts. Dominant finding: Phase-3 "Self-Critique" ↔ "Self-Traps" are 55–90% isomorphic across 11/13 (the cohort row) — named, but NOT called a defect: it is an A/B hypothesis, not an inspection verdict. One *measured* bug: codescout-pika Phase 2b SQL path was `$HOME/.claude/buddy/skills/codescout-pika/sql/` (filesystem-verified absent — bare `$HOME/.claude` resolves the wrong profile for `-sdd`/`-kat`, and the subpath is wrong: installed skills live under the plugin cache, not `~/.claude/buddy/`). Fixed in source to `${CLAUDE_PLUGIN_ROOT}/skills/codescout-pika/sql/` (the plugin-wide convention; verified by grep). Source-fixed only — the runtime prediction (Phase 2b reaches the SQL instead of file-open error) stays `outcome: null` until the next buddy version bump makes it live, then an actual scan confirms. Structural exemplar to imitate: **security-ibex** (genuinely distinct Self-Traps + the `INFO/QUESTION` escape-hatch tier). Distill candidate: **data-leakage `_llm.md`** tail (methods/heuristics over-fit to one project, MRV-poc).

**Snow Leopard redundancy A/B (negative control).**
- *Hypothesis:* cutting the mutation-survival framing 4×→1× — kept OP3 verbatim; removed the Phase-3 bullet, the Format `Mutation-survival` field + its not-ready gate, and Heuristic 1 — DEGRADES mutation-awareness. (I bet the cut fails.)
- *Design:* 5 tasks (clamp, parse_iso_date, final_price, merge_intervals, is_valid) × 2 arms; n=1/cell; blind generators; 1 blind judge scoring MUT (0–3) + QUAL (0–5). Treatment is reproducible: the shipped SKILL.md minus those three echoes, OP3 retained.
- *Result (de-blinded):* MUT control **2.6** vs treatment **2.4** (Δ −0.2/3); QUAL **4.8** vs **4.8**. Per-task MUT — clamp A2/B3, date A2/B1, price A3/B2, merge 3/3, token 3/3 (mixed direction; ±1 per-task swing ≫ the 0.2 arm gap).
- *Verdict:* prediction NOT supported → `outcome: failed`. The cut did not measurably degrade; OP3 alone sustained mutation-awareness in 4/5 tasks (lone drop = parse_iso_date, where operator-mutation framing is least natural — likely task noise). Mildly supports the cross-cutting "redundancy is cuttable" hypothesis, but only regarding *frequency past the first strong statement* (OP3 was kept).
- *To settle conclusively:* n≥5/cell at temp=0, cross-family judge, plus a second treatment that also cuts OP3 (to locate where degradation begins). The cohort A/B (other buddies) is still untested — this pilot informs only the Snow Leopard row.
