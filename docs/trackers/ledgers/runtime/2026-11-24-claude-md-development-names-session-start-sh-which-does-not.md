---
kind: entry
status: open
title: CLAUDE.md § Development names session-start.sh, which does not exist
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- claude-md
---

**What:** the line `bash codescout-companion/hooks/session-start.sh` has no file; the hook is `session-start.mjs`.

**Why it matters:** a session that copies the line gets "no such file".

**Next step:** change it to `node codescout-companion/hooks/session-start.mjs` with the event JSON on stdin.
