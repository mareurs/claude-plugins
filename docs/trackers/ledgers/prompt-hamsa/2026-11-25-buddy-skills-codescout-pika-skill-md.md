---
kind: entry
status: open
title: buddy/skills/codescout-pika/SKILL.md
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 8) on 2026-11-25; audited 2026-06-14.

**Artifact:** buddy/skills/codescout-pika/SKILL.md

**Symptom:** Phase 2b sqlite path $HOME/.claude/buddy/skills/codescout-pika/sql/ — filesystem-verified absent

**Gap:** bare $HOME/.claude (wrong profile for -sdd/-kat) AND wrong subpath (not cache/PLUGIN_ROOT)

**Move:** replace both sql/ refs with ${CLAUDE_PLUGIN_ROOT}/skills/codescout-pika/sql/ (edited+verified in source; live after next buddy bump)

**Prediction:** Phase 2b scan/audit reaches the SQL instead of erroring at file-open (N=1, immediate)

**Eval status:** present(n=1)

**Confidence:** high
