---
kind: entry
status: open
title: 'prompt-engineering framework comparison (cross-repo: ~/work/claude/prompt-engineering)'
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 17) on 2026-11-25; audited 2026-06-14.

**Artifact:** prompt-engineering framework comparison (cross-repo: ~/work/claude/prompt-engineering)

**Symptom:** before scaling the standalone hamsa-eval harness toward prod, need to know whether prompt-engineering (has prompt_tdd.yaml = prompt TDD) already covers it.

**Gap:** two prompt-testing frameworks at ADJACENT layers; growing the standalone harness risks duplicating a more mature framework.

**Move:** read-only exploration + two-way gap analysis. FINDING: prompt-engineering is more mature (tiered assertions, baseline/regression, TextGrad/MIPRO optimization, registry/CLI) but Anthropic-ONLY and tests Claude-Code artifacts (skills/hooks) via headless sessions; our harness tests task-prompt quality via downstream A/B - DIFFERENT LAYERS, not redundant. RECOMMENDATION: don't grow the standalone harness; fold cross-family grading (TOP - their T3 judge.py is Anthropic-only = the single-family blind spot we PROVED diverges), two-level A/B, and findings-as-guidance into prompt-engineering; use prompt-engineering to test the Hamsa SKILL itself (layer our harness can't reach). BLOCKER: their Phase-2 claude-code SDK adapter is unimplemented (bash runner works). Handoff brief: buddy/tests/prompt-hamsa-eval/INTEGRATION.md.

**Prediction:** adding a cross-family judge + divergence check to prompt-engineering judge.py closes a demonstrated weakness; the standalone harness stays a scratchpad rather than productionizing.

**Eval status:** n/a (architecture comparison, not a graded eval)

**Confidence:** high
