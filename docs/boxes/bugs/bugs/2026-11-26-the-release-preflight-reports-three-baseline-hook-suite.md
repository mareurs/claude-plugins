---
kind: entry
status: open
title: The release preflight reports three baseline hook-suite failures under Codex
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:anonymous'
status_since: 2026-11-26
---

**Summary:** A full local release preflight under Codex aborts on three hook suites. The same suites fail on the checkout before the codescout-display card changes.

**Symptom:** The full run ends with `Failed suites: test-session-bridge-run-sh.sh test-session-start-payload.sh test-session-start.sh`. The Session Bridge suite reports Codex arguments in its no-host controls. The SessionStart suites report a missing reconnaissance pointer.

**Reproduction:** Run `./tests/run-all.sh` from Codex. For a control, unpack `git archive 36872aa` in a temporary directory and run those three scripts there under the same harness.

**Evidence:** Each control suite exited 1 with the same assertion failures as the full run. The codescout-display native suite passed, and Buddy pytest passed separately.

**Expected:** The hook suites give the same result from supported release harnesses, and their assertions reflect the current SessionStart payload.
