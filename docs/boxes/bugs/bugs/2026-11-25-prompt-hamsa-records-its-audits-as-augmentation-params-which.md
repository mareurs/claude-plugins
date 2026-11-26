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

## Now

**Done 2026-11-25:**
- The 24 audits are entries of the box `prompt-hamsa` (`04052ab`), made from the template `buddy/skills/prompt-hamsa/box` (`f2f6772`). Each entry holds its row fields verbatim, and A-1 to A-6 hold their record section verbatim; a body-compare script found no loss.
- The flat tracker is moved to `docs/research/2026-11-25-prompt-hamsa-audit-history.md` and holds only its History section; the augmentation sidecar is removed; citations are re-pointed (`aebb689`).
- The first live audit (after buddy 0.12.3) found that the prescribed line `add --title "<gap>"` exits 2 (`body is missing or empty`). Fixed in `40c87e1` (`--text body -`, the fields on stdin); the audit itself is filed (`2026-11-25-the-always-loaded-core-carried-the-measuring-how-to-and`). The cause sits in codescout's `issues` template (codescout bug `2026-11-25-the-issues-template-tells-an-agent-to-leave-the-body-empty`).
- buddy 0.12.4 (`3a02239`) is released with that fix and recorded in all four profiles; verification `6b6d0be`, 39 rows green. **Not pushed.**

**Local verification, 2026-11-27:**
- Fresh Claude Code invocations in all four profiles report Buddy 0.12.5 enabled from their own cache. The installed skill, box template and eval reference match the repository files.
- With Codescout 0.15.0 and an isolated catalog, the installed recipe created a box and added an audit from a linked worktree with `--project <main>`. The audit was committed in the fixture's main checkout. Closing it as `held` recorded the outcome under `## Closed`, and the state persisted in Git.
- Codescout moved its audits to `docs/boxes/quality/prompt-hamsa/` and the protocol to `docs/research/2026-11-25-prompt-hamsa-protocol.md` in `b69998317`. Both references here point to the migrated protocol after `1c86aa0`.

**Open, in this order:**
1. The operator pushes and cold-starts the four profiles.
2. Close this entry as `fixed` after one ordinary audit is filed through the box by a restarted session using the installed recipe without conversational help.
3. Catalog lookup `e34f27e925bf516b` still reports `entry_collection: audits` for the moved history. Cleanup belongs to Codescout E7b-2.
