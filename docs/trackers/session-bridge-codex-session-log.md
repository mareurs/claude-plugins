---
id: cc97050feea829a8
kind: tracker
status: active
title: Session bridge Codex session log
tags:
- session-bridge
- codex
- reconnaissance
topic: session-bridge-codex
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Category | Status | Title |'
entry_high_water_F: 4
entry_high_water_W: 1
---

# Session bridge Codex session log

Verified observations for the Codex interoperation work stream. Entries use the reconnaissance session-log conventions.

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|----------|----------|--------|-------|
| F-1 | 2026-11-16 | high | architectural | fixed-verified | Claude endpoint keys do not identify Codex threads |
| W-1 | 2026-11-16 | — | verification | validated | Installed-host smoke and applied mutations validate the bridge boundaries |
| F-2 | 2026-11-16 | high | host-contract | fixed-verified | Official Claude caller has a host session ID but no legacy IPC socket |
| F-3 | 2026-11-16 | high | attribution | fixed-verified | Inherited Codex variables can misattribute a nested Claude caller |
| F-4 | 2026-11-16 | med | measurement | fixed-verified | **Notice smoke checked before the bridge's 120-second look interval** — corrected window; native context consumption passed. |

## Status vocabulary

Frictions: open, mitigated, fixed-verified, wontfix-false-alarm, promoted-to-bug-tracker, pinned-as-eval-baseline. Wins: validated, promoted-to-permanent-docs, archived.

## F-1 — Claude endpoint keys do not identify Codex threads

**Observed:** 2026-11-16 while preparing Codex interoperation.

**Expected:** Reusing the existing endpoint identity would preserve per-session routing.

**Got:** endpoints::discover reads only Claude sockets/registrations; server::calling_endpoint returns CLAUDE_CONFIG_DIR and parent PID; state::endpoint_path uses profile and PID. Read-only /proc inspection found one Codex app-server holding multiple distinct rollout UUIDs. Its sibling app-server held none. A process-only identity cannot distinguish those threads.

**Severity:** high — adapting hooks without changing identity would mix cursors, self-exclusion and author attribution between threads.

**Status:** fixed-verified

**Resolution:** Codex identities encode canonical config home plus thread UUID; state uses a deterministic thread profile and logical PID 0. Actual host PID/generation remains transport-only. Fixture tests and applied UUID/home/PID/caller/revalidation mutations verify these boundaries; see W-1.

**Valid:** dated 2026-11-16

**Rests on:** source bodies read in session-bridge/mcp-server/src/{endpoints,server,state}.rs and the actual /proc FD snapshot; draft docs/superpowers/specs/2026-11-16-session-bridge-codex-design.md.

## W-1 — Installed-host smoke and applied mutations validate the bridge boundaries

**Valid:** dated 2026-11-16

**Observed:** 2026-11-16. The complete bridge suite passed 287 tests, clippy --all-targets -- -D warnings passed, cargo fmt --check and git diff --check passed. Release build succeeded.

**Status:** validated

**Evidence:** .superpowers/sdd/2026-11-16-session-bridge-codex contains live-smoke evidence (managed 0.160 host; inherited context answer; original rollout hash and mtime unchanged; exact direct user record observed plus native reply) and negative-probe-os.json. The latter records an actual openat(O_WRONLY|O_CREAT|O_TRUNC) failure with EROFS, no marker created, and re-archiving of our test thread. Fake executable and real stdio MCP fixtures validate caller/home/thread isolation and hook JSON output; these fixtures do not establish hook trust acceptance or delivery on a separate desktop stdio host.

**Mutation results:** Independent review applied 15 distinct candidates. After regression fixes it observed 14 killed and one narrow assistant-role survivor. The parent added an assistant/input_text regression, applied that remaining mutation, observed the test fail with observed instead of queued, restored the role check and observed the test pass: all 15 reviewed candidates are now killed. This is a measured campaign, not exhaustive mutation coverage.

**Limits:** Normal hook trust/reconnection remains a user UI step. An unregistered Claude print-mode caller is explicitly refused; interactive caller smoke is recorded separately. No Codex source or executable was changed. No release/version bump or git commit was performed.

## F-2 — Official Claude caller has a host session ID but no legacy IPC socket

**Observed:** Real interactive Claude Code 2.1.325 could list the loaded Codex target, but send_message refused calling session identity. The process held no rollout FD and had no legacy cc-socks registration. An exec wrapper of its actual MCP child captured host-provided CLAUDE_CODE_SESSION_ID and CLAUDE_CONFIG_DIR. Existing caller_session ignores that identity and only accepts Claude socket ancestors.

**Severity:** high — the requested Claude Code → Codex path remains unusable for this installed official host despite fixture/managed-Codex success.

**Status:** fixed-verified

**Next:** Validate the exact host-provided session ID against a matching Claude ancestor, config root and bounded persisted transcript metadata. Preserve refusal for missing/ambiguous identity; do not select a recent/first session. Add sender fixture and real interactive red/green proof before claiming completion.

**Valid:** dated 2026-11-16

**Rests on:** .superpowers/sdd/2026-11-16-session-bridge-codex/claude-mcp-env.json, claude-host-snapshot.json, claude-interactive.txt; src/sessions.rs caller_session and src/endpoints.rs claude_pid_of.

## Official Claude verification follow-up

The real MCP child's parent did have a current per-PID registration, even without an IPC socket. The fix therefore reads that live registration for native Claude processes and ancestor caller detection; it does not adopt CLAUDE_CODE_SESSION_ID. Regression tests cover socket-less native discovery/caller attribution, current registration changes after /clear, non-Claude rejection and bridge-child exclusion. Own Claude ask/filter subprocesses are now tagged as internal.

The real interactive Claude 2.1.325 smoke then succeeded: list_sessions found the requested original Codex thread and send_message returned queued with message ID sb-1794828795733644958-2899021-0. The current target was busy, so consumption was not observed during the bounded window; no retry was performed. Separate disposable-target Codex smoke already observed exact delivery and a native reply. Raw evidence: .superpowers/sdd/2026-11-16-session-bridge-codex/claude-interactive.txt and claude-mcp-env.json. The final suite passes 291 tests after the nested-caller regression; clippy -D warnings and fmt/diff checks pass. The final release artifact is installed at ~/.cargo/bin/session-bridge and configured for ~/.codex. Successful managed-host observations are preserved in managed-host-passed.json alongside the failed probe evidence.

## F-3 — Inherited Codex variables can misattribute a nested Claude caller

**Observed:** Independent review built a valid native Claude ancestor plus current per-PID registration and a loaded Codex endpoint; inherited CODEX_THREAD_ID/CODEX_HOME caused caller_session to select Codex instead of the actual nearer Claude host. The new native_claude_ancestor_wins_over_codex_environment_but_explicit_metadata_still_wins regression reproduced that wrong identity before the fix.

**Severity:** high — wrong notice authors, self-exclusion and sender labels when Claude is launched from a Codex-origin shell.

**Status:** fixed-verified

**Resolution:** Explicit request thread metadata retains priority. Without it, validated Claude ancestry precedes inherited Codex variables, but walking stops at an intervening loaded Codex host so reverse nesting cannot attribute a Codex caller to an outer Claude. Invalid explicit metadata is still refused. Current per-PID registration remains authoritative after /clear.

**Evidence:** New regression red→green, plus actual deletion of the intervening-host stop: survived six tests before extending the regression; after extension it failed with the outer Claude identity instead of Codex. Restored guard passed. Independent native-host review also killed six applied discovery/caller/child-tag mutations; both child-tag mutants survived before their new subprocess-environment assertions. Independent reapplication of the original caller-precedence defect then failed 1 of 6 session tests; restoring the fix returned 6 passing tests.

**Valid:** dated 2026-11-16

**Rests on:** src/sessions.rs caller_session, src/endpoints.rs ppid_of/native_claude_endpoint, tests/sessions.rs nested-caller regression; bridge_code_review installed-host follow-up.

## F-4 — Notice smoke checked before the bridge's 120-second look interval

**Valid:** dated 2026-11-16

**Observed:** Post-restart native MCP listing resolves this task as self, and hooks/list reports all three bridge handlers enabled and trusted. The initial notice probes waited 5.5 seconds before their trigger and inspected before the 120-second look interval had elapsed. They returned NO_BRIDGE_NOTICE with unchanged last_look_ms; this measured an early check, not a broken hook. Native hook/completed events later confirmed UserPromptSubmit and PostToolUse completed. A later final trigger crossed the interval and populated pending/worker_pid, confirming the timing boundary.

**Status:** fixed-verified

**Verification:** Corrected native probe completed 2026-11-16T12:15:07Z: notice 4 received a relevant verdict with no fallback; UserPromptSubmit emitted its exact signal as context, the receiver replied BRIDGE_HOOK_NOTICE_20261116_A7, and delivered=[4]. Both owned threads were archived; the test notice was removed with its deletion tombstone. Evidence: notice-live-smoke.json. Product code was unchanged.

**Severity:** med

**Rests on:** hook.rs LOOK_INTERVAL_MS = 120_000 and on_trigger's due predicate; task-workspace notice-no-tool-smoke.json, notice-posttool-smoke.json, and notice-short-window-smoke.json. The final live test now waits 125 seconds before triggering and then waits for its own filter verdict. Its notification subscription filters exact own thread IDs; unrelated broadcasts are excluded from retained evidence.

**Cost:** Extra model probes came from a harness timing assumption. No product source change was justified by those early negative results. Temporary sender/receiver threads were archived and each test's notice was removed with an exact deletion tombstone.

## Template for new entries

Entries are allocated and appended through doc append_entry. Each names its observation, evidence, validity and dependency.
