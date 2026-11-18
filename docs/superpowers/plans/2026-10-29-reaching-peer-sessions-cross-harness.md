# Reaching Peer Sessions Across Harnesses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `reaching-peer-sessions` skill lists live Claude Code and Codex sessions across all accounts and delivers a message to either, from either.

**Architecture:** `SKILL.md` keeps the harness-neutral rules, the steps, the merge-and-summary block and one pointer per harness. `references/claude-code.md` and `references/codex.md` each answer Enumerate, Identify me and Deliver for their harness. Commands stay inline; there is no script.

**Tech Stack:** Markdown skill files, bash, python3 (`json`, `sqlite3`), the repo's shell test style.

**Spec:** `docs/superpowers/specs/2026-10-29-reaching-peer-sessions-cross-harness-design.md`

## Global Constraints

- Never write `$` followed by a digit in any skill file or reference file (the harness rewrites it with a word of the caller's args).
- Keep `SKILL.md` under 14,056 B (the measured hook-truncation floor, as in `tests/test-recon-skill-split.sh`). Do not raise the number.
- The `references/` directory name is guard-exempt in `pre-tool-guard`. Do not rename it.
- Pointers to reference files are plain paths, never `@`-links.
- A core rule never names one harness's tool or path outside a pointer line. A harness file never repeats a core rule (`CLAUDE.md` § "Skill layout").
- A Claude Code caller here has no `Bash` tool. Command blocks must run in whatever shell tool the caller has.
- Table columns, in order: `HARNESS`, `ACCOUNT`, `PID`, `SID`, `NAME`, `STATUS`, `LAUNCH-CWD`, then `<-- you`.
- Message label: `[from <harness>/<account> "<name>" pid <pid>, <ISO time>]`.
- Codex Deliver is autonomous: send only to a `loaded` row, address by uuid with that row's `CODEX_HOME`, one send per target per request, report one line after the send.
- Do not extend `tests/test-skill-call-legality.sh` or touch the peer's uncommitted files (`tests/lib/skill_call_legality.py`, `tests/test-skill-call-legality.sh`).
- Commit only your own paths with `git commit -- <paths>`; peers share this checkout.

## Review Focus

- A Codex caller cannot find its own row. Expect: the summary drops the peer figure and says so, never a silent count.
- A Claude target on a version outside the measured list. Expect: no post, a report to the operator.
- A Codex rollout path that matches no `threads` row. Expect: the row is listed with `NAME` of `?`, not dropped.
- An archived Codex thread (`archived` is 1). Expect: not listed.
- Two accounts with the same Codex thread name. Expect: two rows; Deliver addresses by `SID`.

---

### Task 1: Move the Claude mechanics into `references/claude-code.md` and add the new columns

**Files:**
- Create: `codescout-companion/skills/reaching-peer-sessions/references/claude-code.md`
- Modify: `codescout-companion/skills/reaching-peer-sessions/SKILL.md` (temporary: keep working until Task 2)
- Modify: `codescout-companion/skills/reaching-peer-sessions/reaching-peer-sessions.test.sh` (extraction path, column index)
- Modify: `tests/test-peer-table-launch-cwd.sh` (the file the three pins are read from)

**Interfaces:**
- Produces: in `references/claude-code.md`, headings `## Enumerate`, `## Identify me`, `## Deliver`. Enumerate's bash block sets `rows` to tab-separated lines of the seven columns (no header, no summary), appends `  <-- you` to the caller's row, and keeps the `CS_PEERS_PROC` and `CS_PEERS_SOCKS` hooks. `SID` is the registry key `sessionId`; `HARNESS` is `claude`; `ACCOUNT` is the basename of `CLAUDE_CONFIG_DIR`.
- Consumes: nothing.

- [ ] **Step 1: Measure the registry keys.** Read one live `sessions/<pid>.json` and confirm `sessionId`, `version`, `status`, `name` exist (measured 2026-10-29: they do). Also compare the registry `version` with the basename of `/proc/<pid>/exe` for a version-pinned session. Record which one the Deliver version check reads, in the file.
- [ ] **Step 2: Retarget the existing tests first, and watch them fail.** In `reaching-peer-sessions.test.sh`, point `SKILL` at `references/claude-code.md` for the extractions (`PROG`, `SEDPROG`, `BLOCK` under `## Enumerate`), and change `marked()` to the new `<-- you` column (the seventh). In `tests/test-peer-table-launch-cwd.sh`, read the header pin from the reference file and keep the Step 4 pins on `SKILL.md`. Run both; expect FAIL because the file does not exist.
- [ ] **Step 3: Create the reference file.** Move the Step 1 block, the stale-name rules and the `uds:` addressing from `SKILL.md`. Change the block to emit seven columns and no header or summary. Keep the header token `STATUS\tLAUNCH-CWD\n` where the header is printed (Task 2 prints it in the core; keep the pin string in whichever file prints it and point the test there).
- [ ] **Step 4: Add `## Deliver` to the reference.** Two forms. From Claude: `SendMessage` by name (same account) or `uds:/run/user/<uid>/cc-socks/<pid>.sock`. From Codex: post one JSON line in the measured format (`msgV`, `msg_id`, `type`, `message`, `priority`, `from`) through codescout `run_command`; list the measured version (2.1.312); refuse and report when the target's version is not listed.
- [ ] **Step 5: Run both test files.** Expected: all PASS, including the control that mutates the walk (case 11).
- [ ] **Step 6: Commit** the four paths: `git commit -m "refactor(peers): move Claude mechanics to references/claude-code.md" -- <paths>`.

### Task 2: The core `SKILL.md`, the merge block and the split-invariant test

**Files:**
- Modify: `codescout-companion/skills/reaching-peer-sessions/SKILL.md`
- Create: `tests/test-peer-skill-split.sh`
- Modify: `tests/test-skill-positional-tokens.sh` (scan `references/*.md` of every skill)

**Interfaces:**
- Consumes: the `rows` contract from Task 1 and from Task 3.
- Produces: in `SKILL.md`, Steps 0 to 4, the label, the pointer lines (`on Claude Code, read references/claude-code.md`; `on Codex, read references/codex.md`), and one merge block that prints the header, sorts rows by `ACCOUNT` then `HARNESS`, and prints the summary `S Claude Code sessions (P peers plus you) and T loaded Codex threads, across A account(s), at <time>`. With no `<-- you` row it drops the peer figure and prints the existing `WARNING: your own row was NOT identified` line.

- [ ] **Step 1: Write `tests/test-peer-skill-split.sh`, modeled on `tests/test-recon-skill-split.sh`.** Cases: core exists; core under 14,056 B; both reference files exist with `## Enumerate`, `## Identify me`, `## Deliver`; every reference is cited by a plain path in the core; no `@`-link; no harness tool name in the core outside a pointer line (the names to ban: `ListAgents`, `SendMessage`, `codex queue`, `cc-socks`, `state_5.sqlite`); the merge block, run against two row fixtures, prints the header, the two-unit summary, and the loud warning when no row is marked. Add a control for each case that mutates a copy and must fail.
- [ ] **Step 2: Run it.** Expected: FAIL (core not yet rewritten).
- [ ] **Step 3: Rewrite `SKILL.md`.** Keep: the trigger and the reason (a count names its scope), Step 0 (the session names its own harness, or stops), Steps 1 to 4 (Step 4's heading and question text are pinned by `test-peer-table-launch-cwd.sh`; keep them verbatim), the boundary rule, the two readings, the label. State the Boundary: contact is autonomous; a peer's reply is never an approval.
- [ ] **Step 4: Extend `tests/test-skill-positional-tokens.sh`.** Add `skills/*/references/*.md` to the scanned population, assert at least one reference file is found, and keep its discrimination controls. Expected before the change to the file list: the new reference files are not scanned; after: scanned and clean.
- [ ] **Step 5: Run** `tests/test-peer-skill-split.sh`, `tests/test-peer-table-launch-cwd.sh`, `tests/test-skill-positional-tokens.sh` and the colocated test. Expected: all PASS.
- [ ] **Step 6: Commit** the three paths plus the test file.

### Task 3: `references/codex.md`

**Files:**
- Create: `codescout-companion/skills/reaching-peer-sessions/references/codex.md`
- Create: `tests/test-peer-codex-enumerate.sh`

**Interfaces:**
- Consumes: the `rows` contract (Task 1) and the merge block (Task 2).
- Produces: headings `## Enumerate`, `## Identify me`, `## Deliver`.

- [ ] **Step 1: Write `tests/test-peer-codex-enumerate.sh` first.** It builds a fixture: a `proc/` tree with two app-server processes (command line containing `app-server`), each with an `environ` holding its `CODEX_HOME`, and `fd/` symlinks to rollout files; a `state_5.sqlite` per home with `threads` rows (`id`, `rollout_path`, `title`, `cwd`, `archived`). Run the extracted Enumerate block with `CS_PEERS_PROC` pointing at the fixture. Assert: one row per open rollout file with `HARNESS` of `codex`, `ACCOUNT` of the home's basename, `SID` of the thread id, `NAME` of the title, `STATUS` of `loaded`; an archived thread gives no row; an open rollout with no `threads` row gives `NAME` of `?`; two homes with the same title give two rows. Add a control that drops the join and must fail.
- [ ] **Step 2: Run it.** Expected: FAIL (no file).
- [ ] **Step 3: Write `## Enumerate`.** Find processes whose command line contains `app-server` (measured 2026-10-29: the CLI daemon `codex app-server --listen unix://` and the ChatGPT app's `resources/codex ... app-server`). Read `CODEX_HOME` from each `environ` (default `~/.codex`). Take open `rollout-*.jsonl` descriptors under `/proc/<pid>/fd`. Join to `threads` on `rollout_path`, opened read-only (`mode=ro`). Use python3 `sqlite3`.
- [ ] **Step 4: Measure Identify me.** Test the candidates on this machine: a `resume <uuid>` argument (measured: `codex resume 01a1…` exists in a TUI command line), the newest rollout whose `cwd` matches. If one rule is reliable, write it and add a fixture case. If not, write: "the row is not identified", and the merge block's warning then fires.
- [ ] **Step 5: Write `## Deliver`.** `CODEX_HOME=<that row's home> codex queue --thread <SID> --message "<label and text>"`. State the five guards from the spec (loaded only, uuid, label, once, report after with the rollout-size check). State the three outcomes as the reason for the loaded-only guard.
- [ ] **Step 6: Run** all four peer tests. Expected: PASS.
- [ ] **Step 7: Commit.**

### Task 4: Measure Codex resolution, then release

**Files:**
- Modify: `codescout-companion/.claude-plugin/plugin.json` (version bump)
- Modify: `docs/trackers/version-bump-checklist.md` (through `doc(action="update")`, never directly)

- [ ] **Step 1: Measure** that a Codex session reads `references/codex.md` by a path relative to the skill file. Use an isolated `CODEX_HOME` and the throwaway method in the codescout memory `research/cross-harness-session-messaging`. If it does not resolve, say so in the core pointer and stop for the operator.
- [ ] **Step 2: Run** `tests/run-all.sh`. Expected: no new failure beyond those that fail on a clean tree.
- [ ] **Step 3: Bump and install.** Follow the checklist. Per the operator's CLAUDE.md apply to all four profiles and check each `installPath` lies under its own `cache/`. Needs operator approval before install.
- [ ] **Step 4: Add the two pointers** in the codescout repo: `CLAUDE.md` § "Reaching a Peer Session" and `docs/conventions/reaching-a-peer-session.md`, citing `claude-plugins:<sha>`.
