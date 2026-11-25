---
kind: entry
status: held
title: 'buddy/tests/prompt-hamsa-eval/ (prod harness: harness.py + archetypes.py)'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 16) on 2026-11-25; audited 2026-06-14.

**Artifact:** buddy/tests/prompt-hamsa-eval/ (prod harness: harness.py + archetypes.py)

**Symptom:** POC proved the instrument only on cost (B); behavioral detection unproven, row-14 grader-divergence untested, harness was throwaway /tmp scripts.

**Gap:** no reusable harness; no behavioral true-positive; row-14 open.

**Move:** productionized the harness (archetypes.py data + harness.py runner + deterministic & LLM graders); added archetype G (hidden routing rules the model can't guess). RESULTS: F null (length/coverage self-heal); G BARKS behaviorally (routing acc 0.75->1.00, +0.25); cross-family probe (run 8) Gemini vs Claude graders DIVERGE on a borderline coverage case (Gemini over-credits 2 vs truth 1; Claude=truth). LAW: prompt quality is visible to an eval only where the model can't self-compensate - cost (B), decisive info/capability gaps (G), or the hard tail; behaviors the model self-regulates (D/E/F) are invisible. Deterministic metrics trustworthy; single-family LLM grader is not. Docs: README.md + RESULTS.md.

**Prediction:** harness detects a behavioral win when the flaw is decisive/non-self-healable (proven by G, +0.25), and cross-family graders diverge on subjective metrics (proven by run 8).

**Eval status:** present (harness; B,G live n=5; D,E,F parked; cross-family probe)

**Confidence:** high

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
