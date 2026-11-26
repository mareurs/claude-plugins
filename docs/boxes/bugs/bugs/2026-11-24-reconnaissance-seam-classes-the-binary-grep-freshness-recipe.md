---
kind: entry
status: fixed
title: 'reconnaissance seam-classes: the binary-grep freshness recipe holds for string literals only, and a stripped binary answers 0 for every identifier'
closed: 2026-11-26
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 open created codescout:be5c3984-2bd4-45c8-897a-3b17ba6e951e'
- '2026-11-26 open -> fixed codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

**Summary:** The freshness law in `seam-classes.md` tells a reader to run `grep -c "<new string>" target/release/<bin>` to see whether a change is in the build. It states no bound. On a stripped binary the grep answers 0 for every identifier, and a reader who probes a renamed function or a changed match arm takes the 0 for "the fix is not in the build".

**Symptom:** On codescout's stripped release binary: `grep -c -a 'OutputBuffer' target/release/codescout` returns 0, `grep -c -a 'may_still_be_writing'` returns 0, and the control `grep -c -a 'store_background'` also returns 0, while the string literal `grep -c -a 'Progressive Disclosure'` returns 2. `file target/release/codescout` reports `stripped`.

**Reproduction:** In the codescout checkout (release build present): run the four greps above, and `file target/release/codescout | grep -o -E '(not )?stripped'`.

**Root cause:** `codescout-companion/skills/reconnaissance/references/seam-classes.md:28` (the freshness law) names `grep -c "<new string>"` and carries no applicability bound. A grep of that file for `stripped`, `string literal` and `identifier` hits only lines 24 and 33, which belong to other seam classes. The recipe answers the build axis only for a change that adds a new string literal. A rename, a match arm, a reordered predicate or a changed comparison adds none, so the probe cannot answer for it.

**Evidence:** bug-fix-session-log:F-169 (in the codescout repository, `docs/trackers/bug-fix-session-log.md`). The entry's own change, `is_running` to `may_still_be_writing` plus two match arms, was unprobeable by this method: the honest claim was "committed", not "live". The plugin's bugs box held 0 matches for "seam-classes stripped binary", "binary grep freshness" and "string literal identifier".

**Fix:** Add one bound to the freshness law: the grep answers the build axis only for a change that introduces a new string literal; on a stripped binary a 0 for an identifier is not evidence, and a control that must be present has to be a string literal. Not done.

**Tests added:** none.

**Resume:** Edit `seam-classes.md:28` with the bound, and check whether `tests/test-recon-count.sh` pins that line.

## Closed

Fixed: the freshness law in seam-classes.md now says the `grep -c "<new string>"` probe answers the build axis only for a change that adds a new string literal; on a stripped binary (`file <bin>` says stripped) a 0 for an identifier, a rename or a changed match arm is no evidence, and the control must be a literal known to be in the binary. tests/test-recon-skill-split.sh case 8 pins both phrases; the previous text has neither, so the case fails there. I did not re-run the filing's greps on the codescout binary. Live in the skill after the next codescout-companion release and a cold restart.
