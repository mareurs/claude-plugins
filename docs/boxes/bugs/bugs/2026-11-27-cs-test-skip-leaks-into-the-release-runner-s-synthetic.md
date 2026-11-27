---
kind: entry
status: open
title: CS_TEST_SKIP leaks into the release runner's synthetic fixtures
created: 2026-11-27
entry_kind: bug
log:
- '2026-11-27 open created codescout:anonymous'
status_since: 2026-11-27
---

**Summary:** A skip for a real suite is inherited by nested runners in synthetic test repositories. The outer suite is absent from those repositories, so the nested runs fail before running their own suites.

**Reproduction:** At `8c8a231`, run `CS_TEST_SKIP=test-skill-call-legality.sh ./tests/run-all.sh`. The nested dependency notice, effort discovery and runtime notice tests report exit 1 and missing ordinary suite execution.

**Root cause:** Each nested invocation validates the inherited skip list against its own discovered suites.

**Resume:** Clear the outer skip list in nested fixtures and retain unknown-skip validation in the real runner.
