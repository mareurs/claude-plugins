---
kind: entry
status: open
title: prompt-hamsa records its audits as augmentation params, which codescout will refuse; it must write to a box
created: 2026-11-25
entry_kind: bug
log:
- '2026-11-25 open created codescout:71d13fb6-69a1-4c81-a031-75bc3b531573'
status_since: 2026-11-25
---

**Summary:** The `buddy:prompt-hamsa` skill records each audit as a row of `params.audits` of the `prompt-hamsa-audit-log` tracker (an augmentation params ledger). codescout is removing params as a store: after its plan E7b-2 lands, every write of params is refused (`append_entry` with params on an `entry_collection` document, `update_entry`, and `doc(augment)` setting `params`). From that release the skill can no longer record an audit or fill an `outcome`, in any repository. Design: codescout `docs/superpowers/specs/2026-11-25-typed-state-file-homes-design.md` (§ E7b-2), decisions D11 and B (operator, 2026-11-25).

**Symptom:** None yet. Expected after the codescout release that carries E7b-2 step 3: the write the skill prescribes is refused with a line that names the document and says params ledgers move into boxes with `codescout trackers`.

**Reproduction:** Not reproducible before that release. Read `buddy/skills/prompt-hamsa/SKILL.md:52` ("Every audit … appends one row to the `prompt-hamsa-audit-log` tracker … fill `outcome` when evidence lands") and `docs/augmentations/docs-trackers-prompt-hamsa-audit-log.yaml:3` (`entry_collection: audits`; its prompt says append by reading `audits`, adding the row and writing the full array back). claude-plugins HEAD at filing: `cb3e098`.

**Root cause:** The skill depends on the augmentation params store. codescout D11: the derived index of committed files is the only store; params have no file home and are not given one (operator decision B: params ledgers end and become boxes).

**Evidence:** codescout catalog audit shard `.codescout/audit/ripper-65e654-202611.jsonl`: `artifact_augmentation` updates on codescout's `docs/trackers/prompt-hamsa-audit-log.md` through 2026-11-20, so the skill is in live use.

**Fix (what this repository must do; the work belongs here, not in codescout):**
1. Migrate this repository's `docs/trackers/prompt-hamsa-audit-log.md` into a box with the `codescout-companion:migrating-trackers` skill: `codescout cutover export` scoped to the tracker and its sidecar (moves the catalog params into the file), commit, then `codescout trackers inventory`, the mapping file, `trackers apply`, `trackers check`. Pick a box key that every repository can use (for example `prompt-hamsa`); codescout migrates its own copy with the same key in E7b-2 step 1.
2. Change `SKILL.md:52` (and any other line that names the tracker or `params.audits`) so that:
   - a new audit is `codescout box <key> add` with gap, move and prediction as fields or body;
   - an `outcome` is filled with `codescout box <key> edit` on that entry, not a params patch;
   - the text stays repo-neutral, and says what to do when the project has no such box (create it with `codescout box new`, or record in claude-plugins' box). Decide which.
3. Release this change no later than the codescout release that refuses params (codescout decision D10: skills that assume catalog behaviour change in the same release). codescout's E7b-2 step 3 waits on this entry.

**Tests added:** none yet.
