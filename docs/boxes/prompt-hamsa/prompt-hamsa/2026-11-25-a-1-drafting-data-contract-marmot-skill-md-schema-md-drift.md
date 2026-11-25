---
kind: entry
status: held
title: 'A-1: drafting — data-contract-marmot (SKILL.md + _schema.md + _drift.md), previewed, NOT written to disk'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 19, id `A-1`) on 2026-11-25; audited 2026-08-26.

**Artifact:** drafting — data-contract-marmot (SKILL.md + _schema.md + _drift.md), previewed, NOT written to disk

**Symptom:** requested behavior only (own VG-1/VG-2 territory). NO observed failure — the premise is an imported claim from ML-ops literature about HUMAN practice: 'one validate() mixing schema and distribution checks, so a seasonal shift and a renamed column raise the same alarm and it gets muted'

**Gap:** the defining principle (never let a check span both layers) has NO decision procedure — only two exemplars (null rate; the schema/quality function name). A stranger satisfies Phase 1.1 'sort every check out loud' by asserting a sort it cannot justify. Also no stop condition and no tool-call budget (my own H6, the highest-leverage fix, unmet)

**Move:** H12 — run the BASE ARM before writing any file. Scenario: table spec + feature spec that tempts the merge (column with nullable:false contract AND seasonally-variable null rate), no skill loaded, n>=10, pinned Opus 5, pre-registered ship rule

**Prediction:** unaided Opus 5 separates structural from statistical on >=8/10 and names >=2 response tiers on >=5/10 -> NO-SHIP as a loaded prompt, keep as tracker documentation closing VG-1/VG-2 on the coverage axis. If it merges layers on >=3/10 the deficit is real and the Marmot ships WITH a layer-sort decision procedure added

**Eval status:** present (n=10, 3 rubrics, pinned claude-opus-5, plugin-free ~/.claude-test-marmot, $5.89)

**Confidence:** medium

## Record

## A-1 — data-contract-marmot: run the base arm first, and unaided Opus 5 already separates the layers

**Audited:** a drafted `data-contract-marmot` specialist (`SKILL.md` + `_schema.md` + `_drift.md`), previewed and deliberately never written to disk. **2026-08-26.**

The premise was **imported, not observed** — a claim from ML-ops literature about *human*
practice (one `validate()` mixing schema and distribution checks, so a seasonal shift and a
renamed column raise the same alarm and it gets muted). No local failure had been seen. The
gap found was that the defining principle carried **no decision procedure**: a stranger could
satisfy *"sort every check out loud"* by asserting a sort they could not justify.

Move: **H12 — base arm before writing any file.** Outcome **held** — the prediction was that
unaided Opus 5 separates structural from statistical, and it did, so the Marmot was
**no-shipped** as a loaded prompt and kept as tracker documentation. Eval present: n=10, 3
rubrics, pinned Opus 5, plugin-free profile, $5.89.

Structured fields for this entry live in `params.audits` and are authoritative; this section
exists to make `A-1` a citable token.

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
