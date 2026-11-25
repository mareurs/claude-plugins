---
kind: entry
status: open
title: buddy/skills/data-leakage-snow-pheasant/_llm.md
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 9) on 2026-11-25; audited 2026-06-14.

**Artifact:** buddy/skills/data-leakage-snow-pheasant/_llm.md

**Symptom:** LLM-lens tail (methods 19–22, heuristics 14–22) carry MRV-poc specifics: dates, $ amounts, file paths

**Gap:** accumulated incident memory promoted into the prompt body without distillation

**Move:** compress war-stories to one-line citations; keep the generalizable kernels

**Prediction:** distilled lens produces same leakage findings on a non-MRV project with less irrelevant context

**Eval status:** absent

**Confidence:** medium
