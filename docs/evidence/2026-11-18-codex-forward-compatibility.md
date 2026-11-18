---
id: f755dbdb21179631
kind: report
status: done
title: Codex forward compatibility — verification and native limits
tags:
- codex
- compatibility
- evidence
---

# Codex forward compatibility — 2026-11-18

## Scope and policy

User approved removal of the exact-version ceiling. Companion source now accepts valid Codex CLI versions from0.165.0 and daemon versions from0.160.0, including newer prereleases and builds. Minimum-core prereleases remain below the stable floor. No config, installed binary, cache, release or issue state is changed. Historical evidence stays exact and unknown eligible versions return evidenceRef=null.

## Verification

Initial focused RED:53 tests,37 pass,16 fail. Final focused GREEN:64/64. Final complete sequential wake suite:231/231, exit0. git diff --check passed. The nine scoped source/test/doc files match the managed worktree byte-for-byte.

./tests/run-all.sh exited1 with only sdd/hooks/lib.test.mjs failing at outside a repo returns null. Its default-TMPDIR and /tmp reruns both found ancestor .git markers and failed; an otherwise unchanged run with TMPDIR=/dev/shm passed37/37. SDD source and tests have no git diff. Marker origin was not established and no shared marker was deleted. The full default-environment repository command is not green. The complete run predates the final review-only coverage additions; final focused and complete wake tests include those additions.

One unrelated baseline path, codescout-companion/hooks/wake-on-job-end.mjs, changed concurrently. This task never copied or edited it; it was preserved. Other snapshot paths outside this scope remained identical at the integrity check. No claim is made about that concurrent change's author.

## Native limits

Two owned isolated /usr/bin/codex0.169.0 daemon runs accepted adapter capability with evidenceRef=null and an honest configured-proof diagnostic. Neither callback probe passed: first failed secondary attach because its rollout metadata was empty; second failed secondary attach with list_turns is not supported yet. Both owned daemons, sockets, threads and temporary profiles were cleaned by the probe/runner. Existing profiles were not changed. This proves removal of the version gate, not native callback preservation or automatic wake on0.169. Callback proof remains mandatory per version/profile.

## Integration and rulings

- Overlaid the existing dirty baseline in a managed worktree and reviewed only the delta against its saved snapshot. Kept changes uncommitted and copied scoped paths back with baseline hash checks to avoid including unrelated repairs. Risk if wrong: an omitted baseline dependency; focused, complete wake and repository runs cover the integrated tree.
- edit_code repeatedly refused anonymous node:test callbacks as stale after refresh. Used exact edit_file replacements for those callback/test wrappers; named production symbols used edit_code. Risk if wrong: unintended test text replacement; exact-match writes and executed tests constrain it.

## Concurrent base update

During final bookkeeping main advanced from e5393d06 to297e2055 (OpenCode PR16). The scoped background-wake/probe/documentation paths have no changes in that committed range, and this task's changes were still modified/untracked locally at that checkpoint. The repository test command predates that unrelated base update. No commit, push or release had been made by this task at that checkpoint.

## Final review

Independent review applied17 distinct mutations:13 killed,4 survived. Three guard survivors also survived the broader110-test suite. The reviewer found two Important coverage gaps and no current production defect.

Added exact patch-boundary prereleases at helper, adapter and intake callsites, and direct disabled/missing enablement, legacy-engine and missing/relative cwd cases. Reapplying the four exact surviving candidates now produces RED: patch skip61/3, hook-context deletion62/2, adapter enablement deletion62/2, intake enablement deletion62/2. Restoring source gives64/64; final complete wake is231/231. Two preliminary coarse guard deletions were diagnostic only; exact subexpression replays are the recorded closure evidence. No second review was requested.

Reviewer set aside native0.169 callback/automatic-wake acceptance, stock0.169 metadata repair, installed-profile rollout/release and whole-repository health beyond its selected tests. Ruling: these remain separate from the approved source compatibility change; native failures and repository failure are explicitly reported here. Cost if wrong: the local policy change must not be mistaken for a deployed/native compatibility certification.

[Independent report](2026-11-18-codex-forward-compatibility-review.md) and [machine evidence](2026-11-18-codex-forward-compatibility.json) preserve observed results.

## Authorized local commit

The user subsequently requested local integration and commit. The commit includes the forward-compatibility change, its required originator-parser repair, tests and supporting evidence/docs. Earlier uncommitted/committed=false statements describe the pre-commit verification snapshot. Native thread identifiers in the published machine evidence are redacted; unredacted diagnostic captures remain outside the repository. No push, version bump, release, installed-profile change or issue closure is included. Fresh pre-commit wake verification is recorded with the commit.
