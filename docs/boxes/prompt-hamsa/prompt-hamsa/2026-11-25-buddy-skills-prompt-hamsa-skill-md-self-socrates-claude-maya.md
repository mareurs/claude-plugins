---
kind: entry
status: open
title: buddy/skills/prompt-hamsa/SKILL.md (self — Socrates/Claude/Maya dialogue)
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 14) on 2026-11-25; audited 2026-06-14.

**Artifact:** buddy/skills/prompt-hamsa/SKILL.md (self — Socrates/Claude/Maya dialogue)

**Symptom:** Three-voice dialogue building on Tao/Buddha: the method is inspection-dominated. Phase 2 commands 'identify decoration, remove first' BEFORE the Phase-3 eval, yet OP2 DEFINES decoration as 'removal that does not measurably worsen output' — knowable only after the A/B. Core ops (name gap / identify decoration / compute fault) are all pre-eval judgments.

**Gap:** inspection wearing measurement's clothing. Socrates: decoration can't be defined before the test it requires. Claude (from inside): the model identifies decoration by guess, can't introspect which tokens carry weight, and can't run the stranger-pass on its own instructions. Maya: the hold-rate rests on non-independent self-graded rows (11/13 same author+session+day, no blinding) + the lone A/B is n=1/cell. Persona-diversity ≠ model-diversity → this dialogue measures nothing either.

**Move:** (a) relabel not delete — inspection-first is irreducible (must act before you can eval); carry the unverified flag harder rather than implying measurement. (b) run ONE adequately-powered cross-family A/B: pre-registered prediction, blind grader from a different model family, n≥5/cell, temp 0. Converges with row 12 (cross-family rerun); would also move rows 6,7.

**Prediction:** the first powered, blind, cross-family A/B (n≥5/cell, temp 0) diverges from the same-model self-grade on at least one logged row — showing the hold-rate was inspection, not measurement. Overturned if blind cross-family grading reproduces every self-grade within noise (inspection was adequate all along).

**Eval status:** absent

**Confidence:** medium
