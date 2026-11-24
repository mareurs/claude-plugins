---
kind: entry
status: open
title: The root .codescout/system-prompt.md is edited by hand and refresh_prompt is never run on it
anchors:
- '.codescout/system-prompt.md sha256:068a22604cbca1949fcfd221767c71aa3255907922f45514b8b26835fdcde7bf'
created: 2026-11-24
entry_kind: decision
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- system-prompt
---

**What:** the file is curated; `onboarding(action="refresh_prompt")` regenerates from templates and may flatten it (`RM-26`, unsettled).

**Why it matters:** the subagent bootstrap tells every subagent to read this file by path.

**Next step:** settle `RM-26` by running a refresh against a copy and diffing.
