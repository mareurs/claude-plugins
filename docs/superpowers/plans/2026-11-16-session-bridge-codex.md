---
id: '4e6be25c094db5c9'
kind: plan
status: active
title: Session bridge Codex Implementation Plan
tags:
- session-bridge
- codex
topic: session-bridge-codex
---

# Session bridge Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user approved implementation on 2026-11-16; execute inline without another approval round.

**Goal:** Let Claude Code and Codex share session discovery/notices, ask isolated Codex forks, and send messages to original loaded Codex threads.

**Architecture:** Keep the existing Claude adapter and SQLite notice format. A new Codex endpoint adapter carries canonical home and thread UUID, with a deterministic thread-scoped storage profile, so existing queue/cursor/store primitives remain reusable without conflating host PID and thread. All product edits stay inside session-bridge.

**Tech Stack:** Rust/tokio/rmcp/rusqlite; installed Codex CLI; JSON hook adapters.

**Spec:** docs/superpowers/specs/2026-11-16-session-bridge-codex-design.md

## Global Constraints

- No changes to Codex source, shared binaries or unrelated peers.
- Existing Claude target strings, stored notices and state stay readable.
- USD cost absent from Codex output is unknown; do not meter as Claude.
- Do not equate queued with observed, or a daemon PID with a thread.
- Do not create absent profile roots or overwrite unrelated settings.
- Test each reachable Codex surface/runtime; missing required capability remains outstanding.
- Work in place in session-bridge with explicit path ownership; preserve concurrent release-script changes. No commit or release step is required to deliver reviewable working files.

## Review Focus

- Two threads share a PID: distinct author/cursor state and self-exclusion (Task 1/4).
- Same names/UUIDs across homes: ambiguous targets rejected and exact home routed (Task 1/3).
- Queue succeeds without consumption: queued status, no automatic retry (Task 3).
- Fork emits a plausible answer then fails or times out: explicit failure and child cleanup (Task 2).
- Host provides no exact caller identity: listing has no false self mark; mutations refuse (Task 4).

## Task 1: Codex discovery and identity

**Files:** create src/codex.rs and tests/codex.rs; add module export.
**Interfaces:** CodexEndpoint {config_dir, pid, session_id, transcript_path, cwd, name}; discover_codex(&Roots)->Vec<CodexEndpoint>; key(), storage_profile(), matches(), revalidate(); is_thread_id(&str)->bool.
- [x] Write CLI-level regression proving current discovery omits a fixture Codex process; run and observe failure.
- [x] Add process/FD/readonly-DB discovery, UUID validation, exact/canonical keys and deterministic storage identity.
- [x] Test two threads in one PID, repeated FD, two homes, locked/missing DB, archived rows, dead process, partial metadata, no open rollout, unsafe UUID and exact revalidation.
- [x] Run cargo test --test codex and existing endpoints tests. Expected zero failures.

## Task 2: Isolated Codex subprocesses

**Files:** create src/codex_process.rs and tests/codex_process.rs; export module.
**Interfaces:** ask_codex(bin,&CodexEndpoint,&Roots,question,model,timeout,state)->CodexAskResult; parse_answer(JSONL)->answer/usage; run_bounded(command,timeout)->captured output.
- [x] Prove installed isolation options with an offline invalid-target call before any model run.
- [x] Write fake-child tests for literal question/model/env and wrong output/exit/timeout; observe failures.
- [x] Implement ephemeral read-only fork with no hooks/plugins/MCP/unsafe rules, absolute executable, target auth profile, bounded output/time, process cleanup and honest null USD.
- [x] Pin completed answer plus successful exit; test failed turn, missing completion and truncated stream.
- [x] Run cargo test --test codex_process. Expected zero failures.

## Task 3: Direct send and unified MCP routing

**Files:** create src/sessions.rs, src/send.rs, tests/send.rs; update server.rs/main.rs and tool schema fixtures/tests.
**Interfaces:** Session (Claude/Codex), discover_sessions/resolve_session; SendResult {message_id,target,status,reason}; send_codex(bin,target,sender,message,timeout)->SendResult. MCP list_sessions/ask_session/post_notice plus new send_message(target,message,timeout_s).
- [x] Write MCP schema/CLI regression for new tool and loaded-thread target, observe failure.
- [x] Merge discovery and resolve across adapters with self/ambiguity checks; use rmcp request metadata for exact Codex caller.
- [x] Implement queue argv/env, sender label and unique marker; revalidate before enqueue; bounded exact appended-record observation.
- [x] Test queued-only, exact marker observed, unrelated growth, unload, nonzero/timeout uncertainty and no resend.
- [x] Run server/send/ask tests. Expected zero failures.

## Task 4: Codex notices and hook delivery

**Files:** create src/codex_hook.rs and tests/codex_hook.rs; modify main.rs/server.rs/filter.rs; add Codex hook wrapper.
**Interfaces:** normalized HookInput; Codex per-thread state profile; post_notice_from(identity,cwd,args); Codex hook entrypoints reuse shared notice store/queue and emit host additionalContext.
- [x] Write tests for sibling-thread notice delivery, exact self exclusion, correct thread cwd/repository and missing caller refusal; observe failures.
- [x] Add thread-scoped posting and cursors, Codex transcript text decoder, subagent/fork exclusion and fail-open context output.
- [x] Keep Claude filter billing; Codex filter runs under its own account when isolated adapter available, otherwise explicit unfiltered fallback.
- [x] Run hooks/filter/store/cursor regression suites. Expected zero failures.

## Task 5: Installation, real smoke and review

**Files:** session-bridge/scripts/install-codex.* and tests; README/commands/skill; evidence under task workspace.
**Interfaces:** idempotent MCP/hook installation or dry-run preserving existing entries and trust; selectable existing profile root.
- [x] Write installer merge tests; observe failure, implement renderer/installer and verify absent roots stay absent.
- [x] Update documentation with exact tool contracts, supported surfaces, queued/observed semantics and activation instructions.
- [x] Run fmt, full bridge cargo test and clippy -D warnings. Expected success.
- [ ] Run isolated installed-host read-only fork and direct queue smoke; verify original history/working files and exact correlated delivery. Run Claude MCP caller against disposable target. Missing boundaries remain outstanding.
- [x] Fresh whole-change review: actually apply candidate identity/account/loaded/isolation/confirmation mutations, run tests, report surviving counts, restore every mutation. Fix Important findings with red/green tests.
- [x] Re-run affected verification and report source implementation versus installed/live status separately.

## Pre-flight interfaces

Task 1 identity feeds Tasks 2–4. Codex state profiles encode canonical home plus UUID, while visible profile remains the actual home. Task 2 subprocess helper feeds Task 3 send and Task 4 optional filter. Task 3 caller resolution feeds Task 4 posting. Task 5 consumes the final CLI/tool/hook contracts. No task edits the peer-owned release scripts.

## Execution evidence — 2026-11-16

Tasks 1–4 are implemented. Task 5 source/build/review/install work is complete: final full suite 291 passing, including official-Claude registration and nested-caller attribution regressions, clippy --all-targets -- -D warnings, fmt --check, git diff --check and release build all succeeded. All 15 applied review mutations are killed after regressions; see session-bridge-codex-session-log:W-1. The installer rollback regression also reproduced an injected write failure before its fix.

Installed only into the existing /home/marius/.codex profile. Dry-run after apply reports no changes; the original codescout-wake PostToolUse hook remains. All three uppercase Codex profile roots are absent and were not created. Claude's /home/marius/.cargo/bin/session-bridge was replaced atomically with the verified release artifact. No Codex source, shared Codex executable, plugin version, peer release file or git index was changed.

Installed-host evidence: managed daemon 0.160 accepted a real isolated ask and an original-thread direct message; inherited context matched, original transcript hash/mtime stayed unchanged, exact delivery and a native reply were observed. strace separately recorded the fork's attempted write returning EROFS with no marker file. Disposable target was re-archived. CLI 0.169 was the child/queue executable.

After the user's restart, all four native MCP tools loaded, list_sessions resolved this original task as self, and hooks/list reported all three bridge handlers enabled/trusted. The queued official-Claude message later arrived in this original thread with the exact diagnostic marker. The corrected private native notice smoke passed after the existing 120-second interval: relevant verdict, completed hook with additionalContext, exact signal in the receiver's reply, delivered=[4], archive of both owned threads and scoped cleanup. Evidence: notice-live-smoke.json; timing correction recorded as F-4. Native Claude callers use the current registration after /clear, not the inherited startup ID.

Remaining acceptance: distinct desktop stdio-host delivery is not certified because that host has no discovered open rollout. Managed-host implementation, installation and activation are verified. Raw evidence and initial failed probes remain under the task workspace. No Codex source or executable was changed.
