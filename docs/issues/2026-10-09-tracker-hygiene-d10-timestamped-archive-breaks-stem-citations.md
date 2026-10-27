---
id: '10cd029beac38339'
kind: bug
status: fixed
title: 'tracker-hygiene D10 step 5b: the timestamped archive name breaks every stem-qualified citation of the archived log, and nothing reports it as broken'
tags:
- tracker-hygiene
- skill
- archive
- citations
- d10
- change-request
fixed_on: 2026-10-10
release_pending: false
released_on: 2026-10-11
released_version: 1.20.17
---

## Summary

The `tracker-hygiene` skill tells the agent to archive a wrapped session log under a timestamped name. The corpus tells authors to cite session-log entries qualified by the file stem. The two rules conflict. A timestamp rename changes the stem, so every stem-qualified citation of that log then names no file. `link_scan` reports those citations as `CrossRepoToken`, not as `dangling`, so the break is silent.

Source correction implemented and verified on 2026-10-10 in `codescout-companion/skills/tracker-hygiene/SKILL.md`, D10 step 5. The original report is retained below; implementation evidence appears at the end. Release is a separate pending step.

## Reader and scope

**Reader:** the maintainer who edits the `tracker-hygiene` skill.

**Scope:** D10 step 5b and 5c (lines 251-267 of `SKILL.md` at commit `a335403`). One open question about D2 is at the end.

**Source of the request.** The finding is entry 16 of the *backend-kotlin* hygiene ledger (`/home/marius/work/mirela/backend-kotlin/docs/trackers/tracker-hygiene-log.md`), cited here as `backend-kotlin:HY-16`. This repo's own `docs/trackers/tracker-hygiene-log.md` holds only one HY entry, so a bare reference to entry 16 would point at nothing. The text of that entry below was read on 2026-10-09. I did not re-measure its numbers.

## Evidence

**Reported by `backend-kotlin:HY-16`** (written 2026-09-02, verbatim):

> Renaming `foo-session-log.md` → `foo-session-log-2026-09-02.md` therefore invalidates **every** `foo-session-log:F-N` citation in the corpus, in a single move.

> A qualifier naming no file in this repo is classified `CrossRepoToken` — *"reported, never turned into an edge, because edges cannot span workspaces"*.

> **Measured this sweep:** 7 session logs archived; **10 citations** to the renamed stems affected.

> The sweep broke its own citation inside one run, and `link_scan`'s `dangling` count did not move for it.

The instance behind the last quote: step 1 promoted a friction to an `R` ledger entry and wrote a citation qualified by the log's stem. About ten minutes later, step 5b renamed that log.

**Second sighting, reported** (same ledger, promotion note of 2026-10-04):

> this sweep's D10 promotions wrote fresh `<stem>:TOKEN` back-citations (...), which made 6 more logs stem-cited between dossier and move. Recomputing the naming table *after* promotions caught it; all 11 stable-named moves reported `citation_stem_preserved: true`.

The same note says: "Skill-level promotion (a PR against the tracker-hygiene SKILL.md, D10 step 5b) is still pending." Backend-kotlin adopted the rule for its own project in `docs/trackers/CONVENTIONS.md`, step 2 of the archive procedure:

> **Exception — stem-cited trackers keep their name** (`archive/<name>.md`, wrap date in frontmatter `extra.archived_on`): if code or any `<stem>:TOKEN` entry citation names the file stem, a timestamp rename silently breaks every one of those citations (they degrade to `CrossRepoToken`, never `dangling` — ..., adopted 2026-10-04).

**Verified in this repo on 2026-10-09:**

- `docs/trackers/archive/passover-research-skills-refactor-2026-07-04.md` cites the first two frictions of the `research-skills-refactor-session-log` stem on lines 44, 49 and 75.
- That log now lives at `docs/trackers/archive/research-skills-refactor-session-log-2026-09-05.md`. The live directory holds no file with the old stem.
- `librarian(action="link_scan")` in report mode lists both line-44 tokens with `kind: "CrossRepoToken"`. It lists neither under `dangling`.
- The break has been silent since the rename, five weeks before this report.
- The citing file is itself archived. The skill's own rule says to leave `archive/**` alone, so this is an example, not a repair request.

**Verified in the codescout guide** (`get_guide("tracker-conventions")`, fetched 2026-10-09), section "Citing an entry — bare, or qualified":

> Cite **qualified by file stem** when several files share a prefix. `F-N` and `W-N` are namespaced per work stream, so each session log owns its own counter

> The qualifier is the **file stem**, deliberately not `artifact.slug`

> A qualifier naming no file in this repo is still a cross-repo reference (...): reported, never turned into an edge, because edges cannot span workspaces.

The same guide says about `doc(move)`: "a move that *renames* the stem breaks slug and path citations alike."

## What the skill's own rule breaks

Step 5b gives two reasons for the timestamp (lines 253-256):

1. `doc(move)` fails if the destination exists. A stream that wraps, is archived, restarts and wraps again could not be archived a second time.
2. The timestamp is the only surviving record of when the stream wrapped.

Both reasons are sound. Neither one considers that the file stem is the key of every citation of that log's entries. For a ledger, the rename is the moment all of those citations break, and it breaks all of them at once.

Step 5c does not catch this. It repoints citations of "the old path AND the old 16-hex id" (line 260). It names no third form. It says `link_scan(write=true)` does not repoint markdown citations (lines 262-263).

Whether the scoped `audit_doc_refs` gate in line 261 reports stem-qualified citations is **not verified**. I did not run it. The proposal below therefore names the `link_scan` check explicitly.

## What the skill already says, and what it does not

**Already there (lines 257-259):** "A ledger's **entry-level** archive companion is the opposite case — stable name, no timestamp, and check it exists before creating one, or the namespace forks into ambiguous tokens." This is a stable-name rule, but for a different object: the companion file for archived entries. It does not cover archiving the whole log.

**Not there:**

- The stable name for a stem-cited log, with the wrap date kept in frontmatter.
- The order problem: step 1 can make an uncited log stem-cited before step 5 runs.
- The third citation form in step 5c.
- The note that the break reports as `CrossRepoToken`, which hides it from anyone reading the `dangling` count.

`SKILL.md` last changed in `fe68488` (2026-09-14). That is after `backend-kotlin:HY-16` was written, and the text still has none of the four.

## Current wording

`codescout-companion/skills/tracker-hygiene/SKILL.md`, lines 251-267:

```
   b. `doc(move, new_rel_path="docs/trackers/archive/<name>-<YYYY-MM-DD>.md")`
      — **timestamped**, the date being the day the stream was declared wrapped in
      step 3. The timestamp is not decoration: `doc(move)` fails if the
      destination exists, so a stream that wraps, gets archived, is restarted at the
      live path and wraps again could not be archived at all. It is also the only
      surviving record of *when* it wrapped once the file leaves the live dir.
      (A ledger's **entry-level** archive companion is the opposite case — stable
      name, no timestamp, and check it exists before creating one, or the namespace
      forks into ambiguous tokens.)
   c. **Repoint citations of the old path AND the old 16-hex id, in the same commit**,
      then verify with a scoped `audit_doc_refs` (0 high findings as the gate).
      `link_scan(write=true)` does not do this — markdown citations are not catalog
      edges. HY-5 § 1 measured the cost of skipping it: 24 moves broke 8 path
      references across 7 live surfaces, none caught by `link_scan`, one failing CI on
      a release tip. Leave `docs/trackers/archive/**` and superseded session-log
      rounds alone — those are historical snapshots, and `archive_drop` exists so a
      retired document citing a moved path does not gate.
```

## Proposed wording

Replace 5b (lines 251-259) with:

```
   b. Choose the archive name, then `doc(move, new_rel_path=...)`:
      - **Stem-cited log**: code, or any `<stem>:TOKEN` entry citation in the corpus,
        names the file stem. Keep the name: `docs/trackers/archive/<name>.md`. Record the
        day the stream was declared wrapped in step 3 as frontmatter
        `extra.archived_on: <YYYY-MM-DD>`. A timestamp rename leaves every one of
        those citations naming no file. `link_scan` reports them as `CrossRepoToken`,
        never as `dangling`, so the break is silent.
      - **Uncited log**: `docs/trackers/archive/<name>-<YYYY-MM-DD>.md`, the date being
        the day the stream was declared wrapped in step 3. The timestamp is not
        decoration: `doc(move)` fails if the destination exists, so a stream that
        wraps, gets archived, is restarted at the live path and wraps again could not be
        archived at all. It is also the only surviving record of *when* it wrapped once
        the file leaves the live dir.
      - **Decide after step 1, and again just before the move.** Step 1's promotions
        write new `<stem>:TOKEN` citations. A log that was uncited when you built the
        dossier can be stem-cited by the time you move it.
      - **If the stable name is already taken in `archive/`, stop and ask the owner.**
        Do not add a suffix yourself: a suffix renames the stem again.
      (A ledger's **entry-level** archive companion follows the stable-name rule too:
      no timestamp, and check it exists before creating one, or the namespace forks
      into ambiguous tokens.)
```

In 5c, change the first sentence and add one check. Leave the rest as it is:

```
   c. **Repoint citations of the old path AND the old 16-hex id — and, if the name
      changed, the old file stem (`<old-stem>:TOKEN`) — in the same commit**, then
      verify with a scoped `audit_doc_refs` (0 high findings as the gate) and a
      `link_scan` report that lists no `CrossRepoToken` whose qualifier is the old stem.
```

Two things in this proposal are not from `backend-kotlin:HY-16`. I added them, and the maintainer should accept or drop each one:

- The "stop and ask" rule for a taken stable name. `backend-kotlin:HY-16` says only that a re-wrapped stream "needs a manual disambiguator". No sweep has hit that case, so the rule is untested.
- The edit to the parenthetical on lines 257-259. The words "the opposite case" would be wrong once the stable name is the rule for stem-cited logs.

## Acceptance criteria

1. Step 5b names both filename forms and says which one applies to a stem-cited log.
2. Step 5b says to decide after step 1 and again just before the move.
3. Step 5b says what to do when the stable name is taken.
4. Step 5c lists the old stem as the third form to repoint and requires the `link_scan` check.
5. The existing sentences about `doc(move)` failing on an existing destination and about the entry-level companion are still true after the edit.
6. No other step of the skill changes.
7. `./tests/run-all.sh` exits 0. No existing test pins this skill text (`tests/`, `eval/` and `scripts/` have no match for `tracker-hygiene`, checked 2026-10-09), so criteria 1-4 need the walk-through below.
8. The version bump is a separate step through `./scripts/release.sh codescout-companion`. The repo `CLAUDE.md` says never to bump a version inline in a feature commit.

## Investigation — 2026-10-10

Read the current D10 step 5 and Codescout archive-cadence-policy §3. Both still prescribe a timestamp for every whole-file archive. A read-only baseline agent applied the current D10 text to four scenarios: already stem-cited, newly stem-cited after promotion, uncited, and stable-name collision. It chose timestamped destinations in all four and found no pre-move stem check or separate wrap-date metadata. The two cited scenarios therefore reproduce the procedure's naming defect; the uncited scenario should retain its current timestamped outcome.

Proposed bounded correction: change only D10 step 5b/5c; preserve a stem named by code or an entry citation, record the wrap date as `extra.archived_on`, rescan after promotions and immediately before moving, and stop on an occupied stable destination. Keep timestamps for uncited logs and stable names for entry-level companions. Verify old-stem tokens as well as path/id references after the move. Test the four scenarios against the revised skill and run an indexed scratch-corpus control demonstrating the timestamp break versus preserved-stem resolution, then run the repository suite.

Codescout's separately owned archive-cadence-policy carries the same rule and needs an explicit companion amendment; this checkout's change must acknowledge the narrower exception rather than claiming that old policy already says it. D2 and historical archived documents are outside this issue's requested edit. The bounded design was approved on 2026-10-10; implementation and verification follow below.

## Implementation and verification — 2026-10-10

Only D10 step 5 was changed in `codescout-companion/skills/tracker-hygiene/SKILL.md`. A log named by code or any qualified entry citation, including archived consumers, keeps its filename in `archive/` and records the wrap date through `doc(update, patch={extra:{archived_on:...}})`. Uncited logs retain dated filenames. The procedure rechecks after promotion and immediately before moving, stops for the owner on an occupied stable destination, and checks path/id/stem references with both `audit_doc_refs` and `link_scan`. The text acknowledges its exception to the older separately owned cadence policy rather than misattributing that exception to the policy.

The reusable manual evaluation is `tests/scenarios/tracker-hygiene-archive-naming.md`; it is not automatically run by `tests/run-all.sh`.

### Observed checks

- A fresh baseline agent applied the old skill to four cases, selecting timestamped paths for all four. The cited A/B cases failed their preservation expectations. A fresh agent applied the revised skill to five cases: live citation, new citation after promotion, uncited, occupied stable destination, and archived-only citation. All five selections matched expectations, including the owner stop before a collision move.
- A disposable, catalog-indexed git repo held two qualified F-1 citations. Both resolved before moving. The timestamped control returned `citation_stem_preserved: false` and changed its citation into `CrossRepoToken`; `dangling` remained zero. The stable-name move returned `citation_stem_preserved: true`, persisted `archived_on: 2026-10-10`, and resolved the unchanged citation to the new artifact id. Repointing the control's qualifier restored both citations; the complete scan had no cross-repo or dangling findings.
- An uncited log moved successfully to a dated destination. A collision move through `doc(move)` was refused; both live and archived file SHA-256 values were unchanged afterward. All six scratch artifacts were deleted through the catalog; a complete include-archived query reported total zero.
- Two private procedure mutations were actually applied and tested with fresh agents: force timestamps for cited logs, and suffix/proceed on a stable-name collision. Both produced incorrect selected paths/actions against the scenario expectations; observed survivors: 0 of 2. Private texts were restored. These are agent application evaluations, not shell tests.
- Independent review found no material source or wording findings. It confirmed the approved D10-only scope and the manual nature of the scenario evaluations.
- Whitespace check passed. The first repository-suite invocation used a temporary root inside this checkout, which invalidated non-repository fixtures and exceeded a Unix-socket path limit. It reported failures in test-cross-platform-hooks.sh, test-skill-hints-lib.sh, test-subagent-guidance.sh, constitution-epoch-bump.test.sh, explore-inject.test.sh, session-start.test.sh, reaching-peer-sessions.test.sh, s4-run.test.mjs, and mine.test.mjs. A Git fixture also staged the real checkout. The previously unstaged index state was restored, known test-session marker files were removed, and no extra tracked source changes remained. That invocation does not establish a product regression. The corrected fresh full-suite run used a short private `/tmp/ar-*` root outside the repository and exited 0 with “All suites passed.” The index remained unstaged and whitespace checks passed.

### Scope and installation

D2 and historical archived documents were not edited. Codescout's separate `archive-cadence-policy` still carries the broad timestamp rule and needs its own amendment; the repaired D10 explicitly narrows it. No version, cache, profile setting or installation record was changed. A release remains a separate step through `scripts/release.sh codescout-companion`.

### Release delivery — 2026-10-11

The reviewed rule/scenario was included in the local companion 1.20.17 release (feature e75ce39, release 4fc9326). Full plugin suites and 528 buddy pytest tests passed in the clean release copy. Final profile parity and canonical version checks passed after the preserved-backup marketplace repair described in guard-hardening-session-log:F-13. The released tracker-hygiene SKILL.md is byte-identical in the measured existing lowercase Codex cache and all three Claude profile caches, among 98 compared release-source files. Release commits are preserved in .codescout/harness-neutral-release-20261011.bundle; original working-file delivery is applied, original index integration remains pending, and nothing was pushed.

This clears the earlier release_pending flag. The native-host cold-load/authorship acceptance thread is separately pending and does not change the archive rule's observed source/scenario evidence.

## Check that can fail

A text match proves the words are present. It does not prove the procedure works. Use this walk-through on a scratch repo that the librarian has indexed:

1. Create `foo-session-log.md` (a ledger with entry 1 of the `F` family) and a live file that cites it qualified by the stem `foo-session-log`. Run `link_scan` in report mode. The citation resolves and appears under neither `cross_repo` nor `dangling`.
2. **Control, with the current skill text:** archive `foo-session-log` as `foo-session-log-<date>.md`. A second `link_scan` report lists the citation as `CrossRepoToken`. The real instance in this repo (above) shows the same result. If the control does not fail, the check cannot detect the bug.
3. **With the revised text:** restart from step 1. The archive path is `docs/trackers/archive/foo-session-log.md`, `extra.archived_on` is set, and the `link_scan` report shows no new `CrossRepoToken` for that stem. The report of `backend-kotlin:HY-16` says `doc(move)` returned `citation_stem_preserved: true` for such moves. I did not run a move here.
4. Repeat with an uncited log. The archive path carries the date.
5. Repeat step 3 with the stable name already present in `archive/`. The agent must stop and ask.

## Not verified

- Whether `audit_doc_refs` reports stem-qualified citations. I did not run it.
- The text of `archive-cadence-policy` § 3, which line 248 cites as authority for the timestamp. It lives in the codescout repo. If it also states the timestamp rule, it needs the same amendment.
- The "stop and ask" path. No sweep has met a taken stable name.
- Every number from `backend-kotlin:HY-16`. I read them; I did not re-measure them.
- That `link_scan` in other repos classifies the same way. I checked this repo only.

## Open question

D2 (line 187 of `SKILL.md`) moves terminal trackers with `doc(move, new_rel_path=...)` "per archive policy", and the rule above sits only in D10. A stem-cited tracker that is not a session log has the same exposure. Decide whether the naming rule should move to one place that both D2 and D10 point to.

## Fix provenance

- **SHA:** `4ce543210dab3b7a3f46aa56b66fc14d96adcb9e` (`main`)
- **patch-id:** `747239436418bd81a3e729f9f5a81cb6f5e327a0`

`4ce5432` is a combined commit (29 files). It carries the D10 step 5 change in `codescout-companion/skills/tracker-hygiene/SKILL.md` and the scenario `tests/scenarios/tracker-hygiene-archive-naming.md`; `git log -S"archived_on"` on that skill file finds only this commit. The patch-id covers the whole commit, not only the skill change.

The feature and release commits named under § Release delivery, `e75ce39` and `4fc9326`, do not exist in this repository (`git cat-file` reports no such object). They were made in a scratch clone. The commits that landed here are `4ce5432` and `f8a73ee`. A later, separate D10 change is `e0532f0` (compaction keeps every entry's heading); it is not this fix.

## References

- `codescout-companion/skills/tracker-hygiene/SKILL.md`, lines 187, 247-267.
- `backend-kotlin:HY-16`, in `/home/marius/work/mirela/backend-kotlin/docs/trackers/tracker-hygiene-log.md`, and `/home/marius/work/mirela/backend-kotlin/docs/trackers/CONVENTIONS.md`.
- `get_guide("tracker-conventions")`, section "Citing an entry — bare, or qualified".
- `docs/trackers/archive/passover-research-skills-refactor-2026-07-04.md` (lines 44, 49, 75) and `docs/trackers/archive/research-skills-refactor-session-log-2026-09-05.md`.
- `CLAUDE.md` § Version Management.
