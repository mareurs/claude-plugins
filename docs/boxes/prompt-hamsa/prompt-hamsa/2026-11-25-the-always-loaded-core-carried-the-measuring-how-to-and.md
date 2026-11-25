---
kind: entry
status: open
title: The always-loaded core carried the measuring how-to and restated its own principles, and sat one byte under its size cap
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

**Artifact:** `buddy/skills/prompt-hamsa/SKILL.md` and `references/eval.md` (commit `a720ec3`).

**Symptom:** the core stood at 10,999 B against the 11,000 B cap of `under_cap` in `tests/test-prompt-hamsa-split.sh`. An addition of 299 B (the box instruction) took it to 11,276 B and failed the test, so the addition had to be squeezed in.

**Gap:** a summon injects the whole `SKILL.md`, and the core held two things most audits do not use: the how-to of measuring (the Harness section, 683 B, the P6 detail, H9, H12) and restatements. Self-Traps (9 items) and H2, H7 and H13 repeated Principles 1, 2, 3 and 7 and Method step 4.

**Move:** the measuring rules and their evidence moved to `references/eval.md`, found through a pointer at the end of Principle 3; H2, H7 and H13 merged into the rules they repeated; Self-Traps went from 9 items to 4. The core went from 10,999 B to 9,511 B. No lens: a `_*.md` file makes a lens mandatory for every summon.

**Prediction:** (a) the old and the new core give the same result on the three `prompt-tdd` scenarios. Measured the same day: 8 of 9 runs pass in each arm, identical run by run. (b) Not yet observed: in the next audits that need an eval, the session reads `references/eval.md` through the Principle 3 pointer. If sessions skip the eval step or never open the file, the pointer is too weak and the how-to belongs back in the core.

**Eval status:** (a) present (n=3 per arm, one judge rubric; the one failing run in each arm is a 0.00 verdict with an empty reason, the known judge defect, so 8 of 9 hides noise). (b) absent.

**Confidence:** low. n=3, and (b) is unmeasured.
