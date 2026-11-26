---
kind: entry
status: fixed
title: buddy tests/test_hooks_session_start.sh stops at line 53, so its reload and compact cases never run, and its first four checks fail on a clean tree
closed: 2026-11-26
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:9e5f6732-9d0f-44f4-b520-802d438dc2c4'
- '2026-11-26 open -> fixed codescout:anonymous'
status_since: 2026-11-26
---

**What happens:** `bash buddy/tests/test_hooks_session_start.sh` prints `Total: 5  Pass: 1  Fail: 4` and exits. Line 53 is `[ "$FAIL" -eq 0 ]` under `set -euo pipefail`, so the script ends there and the roughly 250 lines below it (the resume, compact and recon reload cases, the nudge test) never execute.

**Why the first four checks fail:** the fixtures are bare `mktemp -d` directories. Since commit b93b612 ("a cwd is not a project root") the hook needs a `.git` directory to resolve a project root, so no `.buddy/` is written. Verified: the same event with `mkdir $W/.git` writes `.current_session_id`, `by-ppid/` and the trace log. The failures are identical on a clean `env -i` run and with my changes stashed.

**Measured:** 4 of 5 checks fail; 0 of about 20 reload and compact checks run. No CI or runner step is known to call the script (grep found only the 2026-04-27 plan that created it).

**Fix direction:** create `.git` in each fixture, move the early exit to the end of the file, then run the dead section and repair what has drifted. The compact case was edited on 2026-11-26 (commit 917a815) to seed the compacting session's own state, but it has not been exercised.

**Found while:** changing the compact reload of buddy; the python tests and a manual dispatcher run covered the change instead.

## Closed

The project fixtures have Git root markers under one temporary test directory. The dispatcher resolves the startup event from a nested working directory to its fixture root, and the suite uses a private HOME and Buddy configuration. The summary and exit check are at the end. Resume and startup verify written state, and compact checks for an explicitly empty specialist list.

Verified with all 18 shell checks and 587 Buddy Python tests passing. A run with inherited profile settings and a sentinel in the caller's profile preserved the sentinel. In a temporary control with the first fixture's Git marker removed, its four checks failed, later cases still reached the final reconnaissance assertion, and the script reported 14 passed, 4 failed with exit code 1.
