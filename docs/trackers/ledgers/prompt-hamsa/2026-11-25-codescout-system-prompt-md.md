---
kind: entry
status: partial
title: '.codescout/system-prompt.md'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> partial codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 4) on 2026-11-25; audited 2026-06-14.

**Artifact:** .codescout/system-prompt.md

**Symptom:** codescout flagged outdated (v28→v29); entry-points list ~4 of ~24 hooks

**Gap:** stale template + memory-fed content lags the actual hook set

**Move:** run codescout lightweight refresh (sonnet subagent: re-read memories, regenerate, no re-explore)

**Prediction:** v29 current AND entry-points materially more complete

**Eval status:** present(n=1)

**Confidence:** medium

## Closed

Outcome `partial` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
