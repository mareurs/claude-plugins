---
kind: entry
status: held
title: buddy/tests/prompt-hamsa-eval/ (POC - cross-family eval instrument)
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 15) on 2026-11-25; audited 2026-06-14.

**Artifact:** buddy/tests/prompt-hamsa-eval/ (POC - cross-family eval instrument)

**Symptom:** audit-log was inspection-only (N=0 real measurements); rows 12/14 named cross-family measurement as the missing instrument, never built or run.

**Gap:** no executable eval; the cross-family A/B that turns self-graded inspection into measurement did not exist.

**Move:** built + ran a POC harness (Claude & Gemini Flash-Lite generators; Gemini 3.5-flash blind grader + deterministic checks); 5 runs across D, E, B incl. powered B re-run (n=5,temp0.7). RESULT: 3 true-negatives (D, E(Claude), E(Flash-Lite) all null - safety flaws self-heal at EVERY tier; 'weak model leaks' prediction refuted) + 1 true-positive (B: 70% token cut 168->50, but powered re-run shows a TRADEOFF: acc 1.00->0.90, litotes a8 5/5->2/5 = cut removed scaffolding load-bearing on the hard tail = empirical proof of OP2 over-cutting). FINDINGS: prompt-evals must target NON-safety flaws; strong models mask prompt quality on safety flaws; 'decoration' can be load-bearing. Cross-family DIVERGENCE (row14) still UNTESTED - cases unambiguous. Full: buddy/tests/prompt-hamsa-eval/RESULTS.md

**Prediction:** a working instrument both detects a real effect AND stays silent on a non-effect (no crying wolf).

**Eval status:** present (POC: D n=6, E n=5 x2, B n=8 then n=5/cell)

**Confidence:** high

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
