---
kind: entry
status: open
title: buddy/skills/prompt-hamsa/SKILL.md
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 1) on 2026-11-25; audited 2026-06-13.

**Artifact:** buddy/skills/prompt-hamsa/SKILL.md

**Symptom:** no stop condition; efficacy unmeasurable (N=0 forever)

**Gap:** Method lacked a done-state and a record loop

**Move:** add completeness done-state + per-audit record step (this tracker)

**Prediction:** Hamsa stops at completeness not max-cut; audits accumulate as scored rows; N=0 becomes a hold-rate

**Eval status:** absent

**Confidence:** medium
