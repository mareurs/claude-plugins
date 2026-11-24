---
kind: entry
status: done
title: CLAUDE.md § Development names session-start.sh, which does not exist
closed: 2026-11-24
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-24 open -> done codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- claude-md
---

**What:** the line `bash codescout-companion/hooks/session-start.sh` has no file; the hook is `session-start.mjs`.

**Why it matters:** a session that copies the line gets "no such file".

**Next step:** change it to `node codescout-companion/hooks/session-start.mjs` with the event JSON on stdin.

## Closed

Line now runs node codescout-companion/hooks/session-start.mjs; run and exit 0.
