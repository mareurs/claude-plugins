# Handover: session channel (execute the plan in a claude-plugins session)

From: session `4bbde027` (codescout checkout, profile `.claude-stef`), 2026-11-15.
To: the session that executes the plan, started with cwd = the worktree below.
Status of this file: information for the next session. It is not an approval for any gated step.

## Where everything is

| Thing | Location |
|---|---|
| Worktree (use this, not the shared checkout) | `/home/marius/work/claude/claude-plugins.worktrees/session-channel` |
| Branch | `feat/session-channel`, created from `74ce9ab` (the plan commit). Not pushed. |
| Design (the binding authority) | `docs/superpowers/specs/2026-11-15-session-channel-design.md` (`31dd571`) |
| Plan (10 tasks) | `docs/superpowers/plans/2026-11-15-session-channel.md` (`74ce9ab`) |
| Crate | `session-bridge/mcp-server` (binary becomes `session-bridge`) |
| SDD workspace (git-ignored, created, still empty: no ledger yet) | `.superpowers/sdd/2026-11-15-session-channel/` |
| Spike evidence | codescout memories `research/session-ask-fork-spike-20261115`, `research/session-notice-relevance-spike-20261115` (read with `memory(action="read", ...)` in the codescout project) |

The shared checkout `/home/marius/work/claude/claude-plugins` is on `main` at `74ce9ab`. Another session left an untracked `docs/trackers/harness-identification-session-log.md` there. Do not touch it. Do not implement on `main`.

## Decision already made by the operator

Execution method: **subagent-driven** (`superpowers:subagent-driven-development`). One implementer and one reviewer per task, then one whole-branch review. Per `~/.claude*/CLAUDE.md`, task reviewers run on Opus. Each reviewer brief must tell the reviewer to load `codescout-companion:reconnaissance` with the Skill tool, and `buddy:architecture-snow-lion` for design-shaped tasks (Tasks 2, 5, 6, 8, 9).

## Done so far

- Design and plan written and committed. Two independent builder checks folded in.
- Worktree and branch created.
- Reconnaissance of the real crate (below). No code written. No implementer dispatched. No ledger written yet.

## What to do first

1. Start the session in the worktree. Run `bash <superpowers>/skills/subagent-driven-development/scripts/sdd-workspace <plan path>`. Create `progress.md` there with the first line `# SDD ledger — plan: docs/superpowers/plans/2026-11-15-session-channel.md`.
2. Write the pre-flight table (rows below are a start) into the ledger.
3. Dispatch Task 1.

## Pre-flight findings from my scout (plan text vs. the real crate)

These are facts I read in the worktree. Rule on them in the ledger as `Ruling: …`.

| # | Finding | Proposed ruling |
|---|---|---|
| P1 | `src/tools.rs` exists and imports `registry` and `claude_cli`. `lib.rs` has `pub mod tools`. Task 1 does not list it. | Task 1 deletes `src/tools.rs`; `server.rs` replaces it. `lib.rs` exports `error, paths, server` only (later tasks add theirs). |
| P2 | `Cargo.lock` is tracked. Task 1 does not list it. Task 10 installs with `--locked`. | Task 1 commits the updated `Cargo.lock`. |
| P3 | `main.rs` declares `mod registry; mod claude_cli;` itself, as well as `lib.rs`. | `main.rs` uses the library crate (`session_bridge_mcp::…`), no `mod` lines. |
| P4 | `docs/claude-cli-probe.md` exists and describes the removed design. | Task 10 updates or deletes it with the README. |
| P5 | `error.rs` has `Timeout(u64)` but not `TargetNotFound`, `AmbiguousTarget`, `TargetIsSelf`, or a budget error. No task lists `error.rs` after Task 1. | Each task may add the variants it needs to `error.rs`. Task 1 drops registry-only variants. |
| P6 | Task 6 and Task 8 name `hook::session_start(input, roots, state, store)` and `hook::on_trigger(input, roots, state, store, now_ms, spawn)`. Neither takes the endpoint (profile, pid), yet both need it. | Add `me: (&str, u32)` as the second parameter of both. |
| P7 | Task 9: `post_commit_notices` must compare commit time with `last_post_ms`, but `Counted` has no time field. | Add `committed_ms: i64` to `Counted`. |
| P8 | Task 8 spawns the worker when "a look ran", so the worker can start with empty `pending`. Task 7's `run_filter` does not say what it does then. | With empty `pending`, `run_filter` makes no model call and returns `Ok`. Task 9's commit scan still runs first. |
| P9 | Task 3 test `ask_refuses_over_the_daily_bound` is worded in a confusing way. | Seed the log so spend today is ≥ 2.0 → refused before spawn. Seed 1.99 → allowed. Yesterday's spend never counts. Rule: refuse when `spent_today >= DAILY_BOUND_USD`. |
| P10 | Task 4 `head()` reads `sqlite_sequence`. | The `notice` table must use `INTEGER PRIMARY KEY AUTOINCREMENT`. |

Dependencies: `rusqlite`, `libsqlite3-sys`, `clap 4`, `clap_derive`, `globset`, `chrono` and `nix 0.27.1` are all in `~/.cargo/registry/cache`. Toolchain: rustc/cargo 1.99.1. Baseline `cargo test` in the old crate: 19 passed (measured earlier in the main checkout, not yet in this worktree).

## Gated steps: stop and ask the operator

- **Task 10 Step 5:** installing the plugin in the four profiles (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`, `~/.claude-stef`). Each with its own cache path. Check that `installPath` starts with that profile's root.
- **Task 10 Step 6:** the live check needs two real sessions in two profiles, both after `/mcp`. The operator must start the second one.
- **Task 10 Step 7:** the codescout `.claude/notice-watch.txt` commit, only with the operator's word, by exact path, in the codescout repo.
- Unverified until Step 6: that `PostToolUse` `additionalContext` reaches the model. If it does not, deliver on `UserPromptSubmit` only and record it.
- `cargo install` (Task 10 Step 3) writes `~/.cargo/bin/session-bridge`. This is the only side effect outside the worktree before the gates.

## Standing rules (from the operator)

- No push anywhere. Merging `feat/session-channel` into `main` is the operator's decision (`finishing-a-development-branch` menu).
- Commit by exact path. Never `git add -A` or add a directory.
- Memory and trackers: codescout only, never Claude Code memory. Write trackers in English.
- Verify, never assume. Scout a seam before dispatching on it (`codescout-companion:reconnaissance`).
- Config changes go to all four profiles.
- Do not run `ExitWorktree` or delete branches unless the operator asks.

## Review Focus (the plan's five, each has a pinned test)

Twins (same session id live in two profiles), `/clear`, the fork never writes to the target, a Haiku failure still delivers (marked unfiltered), a rebased or merged commit gives no second notice.
