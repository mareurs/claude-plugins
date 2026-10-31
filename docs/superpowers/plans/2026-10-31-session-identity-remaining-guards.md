# Harness-neutral commit guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `post-index-change-stage-log.sh`, `pre-commit-foreign-index.sh`, `commit-mine.sh`, `git-safe-reset.sh` and `mutation-probe.sh` in the codescout repository resolve a Claude or Codex session identity, with one owner format and one comparison rule.

**Architecture:** All five source the helper `scripts/publish-identity.sh` that the Codex hold branch adds. A Codex owner is written as `codex:<root id>`; a Claude owner stays the bare id. Every owner comparison goes through one new function that strips a `codex:` or `claude-code:` prefix first, because `usage.db` stores bare ids for both hosts. Missing or conflicting identity keeps each script's present refuse-or-inert behaviour.

**Tech Stack:** bash 4 (associative arrays are already used), Python 3 (`session_context.py`), SQLite (read-only), git.

**Spec:** `docs/superpowers/specs/2026-10-31-session-identity-remaining-guards-design.md` (including *Open decision — owner format*, option 2 chosen 2026-10-31). Parent: `docs/superpowers/specs/2026-10-10-harness-neutral-session-identity-design.md`.

## Global Constraints

- Work only in an isolated worktree of the codescout repo created from `origin/experiments` after the Codex hold branch has landed there (Task 0). The main checkout holds another session's uncommitted work: never edit it.
- Use `scripts/publish-identity.sh` as the only identity helper. Do not copy it and do not add a second resolver.
- A Claude owner stays the bare session id, byte for byte. Only a Codex owner is qualified.
- Never fabricate a Claude id, never use a PID, never read a last-writer pointer as identity.
- The session id grammar is `[A-Za-z0-9-]+`; `publish-identity.py` already enforces it.
- `-` and the empty string are never equal to any owner, including each other.
- Git hooks (`post-index-change-stage-log.sh`, `pre-commit-foreign-index.sh`) must never fail the user's git command because identity resolution failed.
- The `session_context.py` contract (version 1) does not change.
- No push, no release, no profile or cache change. Deliver a local branch.

## Review Focus

- A Codex session's own earlier write reads as a peer's, because the write record is bare and `$me` is qualified (the archived `attribute-red` bug class). Pinned in Tasks 2 and 3.
- `CLAUDE_CODE_SESSION_ID` and `CODEX_SESSION_ID` both set (Codex launched from inside a Claude session). Each script must treat it as missing and say why. Pinned in Tasks 2 to 6.
- A Codex child's write (`<root>/<agent>` in `usage.db`) must attribute to the root. Pinned in Task 2.
- Stage-log rows written before the upgrade (bare owner) must still match a Codex or Claude `$me` that equals them. Pinned in Task 3.
- `-` or empty owners compare equal to something. Pinned in Task 1.

---

### Task 0: Gate, worktree and baseline

> **Status 2026-10-31: Task 0 DONE with a recorded override.** `f7d6c797e` still was not in `origin/experiments` (no live session owns the branch; its worktree is clean and four days idle). The user said "yes, go" to stacking and to running the owed gate. Done without touching the Codex worktree: `$WT` = `/home/marius/work/claude/codescout.worktrees/neutral-commit-guards`, branch `feat/neutral-commit-guards-20261031` (upstream removed so it cannot be pushed by accident), created from `origin/experiments` (`ea3c12600`) with `git cherry-pick -x f7d6c797e cb50bc4e1` (new SHAs `3cfce2978`, `200f6a7e1`). When the original branch lands, rebase with `git rebase --onto origin/experiments 200f6a7e1`; `git` drops the duplicate patches. Baseline in `$WT`, all exit 0: `tests/commit-mine.sh` 57, `tests/git-safe-reset.sh` 35, `tests/mutation-probe.sh` 70, `tests/hooks-discrimination.sh` 302, `tests/hold-publish.sh` 91, `tests/pre-push-foreign-session-guard.sh` 412, `tests/prepare-commit-msg-session-id.sh` 21, pytest (`test_codex_publish_hold.py`, `test_pre_commit_publish_hold.py`, `test_session_context.py`) 95. The full gate on this tree was started in the background (`@bg_00000017`).

**Files:** none changed.

**Interfaces:**
- Produces: a worktree path `$WT`, used by every later task.

- [ ] **Step 1: Confirm the prerequisite landed.** Run `git -C /home/marius/work/claude/codescout fetch origin && git -C /home/marius/work/claude/codescout merge-base --is-ancestor f7d6c797e origin/experiments; echo $?`. Expected `0`. If it is not `0`, STOP and report to the user: do not copy `publish-identity.sh` and do not stack on the unpushed branch.
- [ ] **Step 2: Create the worktree.** `git -C /home/marius/work/claude/codescout worktree add -b feat/neutral-commit-guards-20261031 /home/marius/work/claude/codescout.worktrees/neutral-commit-guards origin/experiments`. Confirm `scripts/publish-identity.sh` exists there.
- [ ] **Step 3: Baseline.** In `$WT` run `bash tests/commit-mine.sh`, `bash tests/git-safe-reset.sh`, `bash tests/mutation-probe.sh` and `bash tests/hooks-discrimination.sh`. Record each exit code and pass count. Expected: all exit 0. Any failure here is pre-existing: report it and do not continue until the user decides.

### Task 1: Principal equivalence in the helper

**Files:**
- Modify: `scripts/publish-identity.sh`
- Test: create `tests/publish-principal.sh`

**Interfaces:**
- Produces: `publish_principal_root <token>` prints the token without one leading `codex:` or `claude-code:`. `publish_principal_equal <a> <b>` returns 0 iff both are non-empty, neither is `-`, and their roots are equal; otherwise 1.

- [ ] **Step 1: Write the failing test** `tests/publish-principal.sh`, in the style of `tests/hold-publish.sh`, sourcing the helper. Cases: `bare_equals_codex_qualified` (`U` and `codex:U` equal), `claude_qualified_equals_bare` (`claude-code:U` and `U` equal), `different_ids_differ` (`U` and `V` not equal), `dash_never_equal` (`-` against `-` and against `U` both return 1), `empty_never_equal` (`""` against `""` and `U` both return 1), `codex_and_claude_qualified_same_id_equal` (documented trade-off: returns 0).
- [ ] **Step 2: Run** `bash tests/publish-principal.sh`. Expected: FAIL, `publish_principal_equal: command not found`.
- [ ] **Step 3: Implement** both functions in `scripts/publish-identity.sh` with parameter expansion only (`${1#codex:}`, then `${…#claude-code:}`). No subshell, no state at source time.
- [ ] **Step 4: Run** the test. Expected: all cases PASS.
- [ ] **Step 5: Commit** `feat(git): compare session principals across hosts` with the two files.

### Task 2: Stage-log writer and peer lookup

**Files:**
- Modify: `scripts/post-index-change-stage-log.sh` (the `me=` line near `:113`; the `[ "$sid" = "$me" ]` test in `foreign_writer`; the header comment about `CLAUDE_CODE_SESSION_ID` near `:72`)
- Test: `tests/hooks-discrimination.sh`

**Interfaces:**
- Consumes: `publish_identity` (prints the principal, empty when missing, exits 2 when conflicting) and `publish_principal_equal` from Task 1.
- Produces: stage-log owner column is the bare id for Claude, `codex:<root id>` for Codex, `-` when identity is missing or conflicting. Route for `-` from identity is `id-unset`.

- [ ] **Step 1: Write failing tests** in `tests/hooks-discrimination.sh`, reusing the fixture helper the existing `named-foreign` case uses (grep `named-foreign` there). Cases: `codex_only_stager_is_recorded_qualified` (`env -u CLAUDE_CODE_SESSION_ID CODEX_SESSION_ID=U`, `git add f` gives owner `codex:U`, route `named`), `codex_own_prior_write_is_not_a_peer` (a `usage.db` row with bare `cc_session_id` `U` for `f`, then the same Codex `git add f` gives owner `codex:U`, route `named`, not `named-foreign`), `codex_child_write_attributes_to_root` (row `V/agent1` for `f`, stager Claude `U`: owner `V`, route `named-foreign`), `conflicting_identity_records_dash` (both variables set: owner `-`, route `id-unset`, hook exit 0).
- [ ] **Step 2: Run** `bash tests/hooks-discrimination.sh`. Expected: the four new cases FAIL, all existing cases still PASS.
- [ ] **Step 3: Implement.** Source the helper the way `hold-publish.sh:34` does. Resolve `me` once at the top: `-` when `publish_identity` prints nothing or exits non-zero. In `foreign_writer`, replace the string test with `publish_principal_equal "$sid" "$me"`. Update the header comment so it no longer says the id comes only from `CLAUDE_CODE_SESSION_ID`.
- [ ] **Step 4: Run** the suite. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(git): record Codex stagers in the stage log`.

### Task 3: Foreign-index guard

**Files:**
- Modify: `scripts/pre-commit-foreign-index.sh` (`me=` near `:109`; owner test near `:274`; messages near `:111` and `:622`)
- Test: `tests/hooks-discrimination.sh`

**Interfaces:**
- Consumes: `publish_identity`, `publish_principal_equal`.
- Produces: with Codex-only identity the guard classifies as for Claude. Conflicting identity behaves as missing (silent exit 0; `--classify` exits 2) and prints one line on stderr naming the two variables.

- [ ] **Step 1: Write failing tests:** `codex_only_own_staged_is_mine`, `claude_peer_staged_is_theirs_with_bare_owner`, `pre_upgrade_bare_owner_row_matches_codex_self` (a log row whose owner is bare `U`, session `CODEX_SESSION_ID=U`: classified `mine`), `conflicting_is_silent_with_stderr_note`, `classify_conflicting_exits_2`. The existing `no session id -> silent` case must still pass.
- [ ] **Step 2: Run** the suite. Expected: new cases FAIL.
- [ ] **Step 3: Implement.** Resolve `me` through `publish_identity`; replace `[ "$owner" != "$me" ]` with `! publish_principal_equal "$owner" "$me"`, keeping the existing `-` handling ahead of it. Change the two messages so neither claims the caller is the only writer.
- [ ] **Step 4: Run** the suite. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(git): let the foreign-index guard classify Codex sessions`.

### Task 4: `commit-mine.sh`

**Files:**
- Modify: `scripts/commit-mine.sh` (`me=` and the refusal at `:41-45`)
- Test: `tests/commit-mine.sh`

**Interfaces:**
- Consumes: `publish_identity`. Exit codes keep the header's table (`2` usage).

- [ ] **Step 1: Write failing tests:** `codex_only_commits_own_and_leaves_peer` (a staged own file and a staged peer file; Codex-only commit takes only the own file; exit 0) and `conflicting_identity_exits_2_with_reason`. The existing missing-id case must still exit 2.
- [ ] **Step 2: Run** `bash tests/commit-mine.sh`. Expected: the two cases FAIL.
- [ ] **Step 3: Implement.** Replace the `me` block: exit 2 when `publish_identity` prints nothing, naming both variables; exit 2 with the resolver's message when it exits non-zero.
- [ ] **Step 4: Run.** Expected: all PASS.
- [ ] **Step 5: Commit** `feat(git): commit-mine accepts a Codex session`.

### Task 5: `git-safe-reset.sh`

**Files:**
- Modify: `scripts/git-safe-reset.sh` (guard at `:59-72`)
- Test: `tests/git-safe-reset.sh`

- [ ] **Step 1: Write failing tests:** `codex_only_is_not_refused_for_identity`, `conflicting_identity_exits_2`, `missing_identity_message_does_not_claim_exclusivity` (stderr must not contain `only writer`; exit stays 2). **Also change the existing case 7 assertion `no sid names the solo-checkout fallback`** in `tests/git-safe-reset.sh` on purpose: the new wording drops the solo-checkout claim, so that assertion must become a check that the message names both variables. Record the change in the commit message.
- [ ] **Step 2: Run** `bash tests/git-safe-reset.sh`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard with `publish_identity`. New missing-id text: without a session identity this script cannot attribute a peer's staged work, so it refuses; naming `CLAUDE_CODE_SESSION_ID` and `CODEX_SESSION_ID`. Keep the three `git reset` forms as information, without the claim that the caller is probably alone.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): git-safe-reset accepts a Codex session`.

### Task 6: `mutation-probe.sh`

**Files:**
- Modify: `scripts/mutation-probe.sh` (`SID=` and the refusal at `:139-143`)
- Test: `tests/mutation-probe.sh`

- [ ] **Step 1: Find the marker's readers:** `grep -rn "mutation-probe\|MUTATION-PROBE" scripts tests docs/conventions`. If any reader parses the marker's author as a bare UUID, extend that reader in this task.
- [ ] **Step 2: Write failing tests:** `codex_only_marker_names_codex_principal`, `conflicting_identity_exits_2`; keep the missing-id case (exit 2).
- [ ] **Step 3: Run** `bash tests/mutation-probe.sh`. Expected: FAIL.
- [ ] **Step 4: Implement** with `publish_identity`; the marker's author is the principal it prints.
- [ ] **Step 5: Run.** Expected: PASS. **Commit** `feat(git): mutation-probe accepts a Codex session`.

### Task 7: Mutation checks, gate and records

**Files:**
- Modify: `docs/conventions/harness-neutral-session-context.md` (capability and scope text)
- Modify (claude-plugins repo): `docs/issues/2026-10-09-harness-neutral-session-identity-and-provenance.md`

- [ ] **Step 1: Mutation recipes**, each applied to a copy and reverted: (M1) make `publish_principal_equal` a plain string test, so Tasks 2 and 3 cases `codex_own_prior_write_is_not_a_peer` and `pre_upgrade_bare_owner_row_matches_codex_self` must go red; (M2) let `-` equal `-`, so `dash_never_equal` goes red; (M3) drop the conflicting branch in `commit-mine.sh`, so `conflicting_identity_exits_2_with_reason` goes red; (M4) revert the `foreign_writer` comparison, so `codex_own_prior_write_is_not_a_peer` goes red. Record each result.
- [ ] **Step 2: Full leased gate** in `$WT`: `./scripts/gate.sh`; start it in the background and wait for the completion notice. Expected: exit 0 with every lane code 0.
- [ ] **Step 3: Update the convention doc** to say which scripts accept Codex and under which owner format, and state that no live Codex run covered them.
- [ ] **Step 4: Commit** in `$WT` as `docs(git): record Codex support in the commit guards`. Update the plugin bug ledger with the SHAs, mutation results and gate lane codes. Do not push either repository; report the branch and SHAs.
