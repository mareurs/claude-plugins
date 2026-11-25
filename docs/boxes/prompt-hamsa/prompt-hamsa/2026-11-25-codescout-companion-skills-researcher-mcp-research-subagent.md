---
kind: entry
status: held
title: codescout-companion/skills/{researcher-mcp,research-subagent,research-web} (+ pi extension)
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 18) on 2026-11-25; audited 2026-07-04.

**Artifact:** codescout-companion/skills/{researcher-mcp,research-subagent,research-web} (+ pi extension)

**Symptom:** 3 research skills describe a fictional researcher API; a subagent would call a non-existent tool

**Gap:** tool-dialect drift: skills claim 1 tool research_run(target=); real server has 6 tools (research, research_code, ...), no research_run, no summary_style param

**Move:** root-fix researcher-mcp to the real 6-tool API + propagate to both action skills + pi indicator; then portable-slice prompt-tdd eval

**Prediction:** post-fix subagent calls resolve to mcp__researcher__research*; >=1 eval scenario shows --ablate power

**Eval status:** attempted; blocked L-7 (n=2 positive RED)

**Confidence:** high

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
