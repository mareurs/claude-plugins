---
kind: entry
status: open
title: 'sdd: sdd-init and review create the constitution tracker with augmentation params, which codescout 0.15.0 refuses, so test-skill-call-legality fails and blocks release.sh'
created: 2026-11-25
entry_kind: bug
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**What happened:** `bash tests/test-skill-call-legality.sh` gives 78 passed, 3 failed (codescout 0.15.0):
- `sdd/commands/sdd-init.md:34`: the `doc create` call is refused: "docs/trackers/constitution.md keeps its entries in augmentation params, which codescout does not write; move the ledger into a box with codescout trackers (the migrating-trackers skill), and record new entries in a box (codescout box <key> add)".
- `sdd/commands/review.md:19`: "find by tag constitution returns the created tracker" fails, because the create above did not happen.
- `sdd/commands/review.md:20`: "placeholder <constitution id> is known" fails for the same reason.

The same test gave 82 passed, 0 failed earlier on 2026-11-25/26, so the binary changed its behaviour, not the repository (the last commits of `sdd/commands` are older).

**Effect:** `release.sh` stops at its test gate for every plugin. `codescout-companion` 1.23.9 had to go out with `SKIP_TESTS=1`. More important: `/sdd:sdd-init` cannot create the constitution tracker on a machine with this binary, so strict SDD cannot be set up.

**Fix direction:** the constitution moves into a box (`codescout box constitution add`), and `sdd-init.md`, `review.md`, the constitution guard and brief hooks, and `case_sdd_calls` follow. This is a design change of the stable `sdd` plugin, not a one-line edit.

**Repro:** `bash tests/test-skill-call-legality.sh 2>&1 | grep -E 'FAIL|Results'`.
