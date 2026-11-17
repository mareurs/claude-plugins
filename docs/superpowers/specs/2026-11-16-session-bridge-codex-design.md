---
id: '79b4c09a4c53df7d'
kind: spec
status: approved
title: 'Session bridge: Codex and Claude Code interoperation'
tags:
- session-bridge
- codex
- cross-harness
topic: session-bridge-codex
---

# Session bridge: Codex and Claude Code interoperation

## Intent and user decisions

Extend the existing session-bridge plugin so Codex can participate, and Claude Code can communicate with Codex. The user explicitly requested both read-only questions and direct messages that start a turn in the original Codex thread. The user explicitly prohibited changes to Codex source code. All implementation belongs to this plugin repository; use the installed Codex interfaces.

## Current evidence

- The existing Rust server exposes list_sessions, ask_session and post_notice.
- endpoints::discover enumerates Claude socket holders and Claude registration files only.
- server::calling_endpoint uses CLAUDE_CONFIG_DIR and the immediate parent PID.
- State and notice self-exclusion use (profile, PID). That cannot distinguish multiple Codex threads hosted by one app-server.
- HookInput and filter::speech understand Claude hook payloads/transcripts only.
- The existing bridge cargo suite passed on 2026-11-16: 249 passed, zero failed.
- Installed CLI reports codex-cli 0.169.0. Its help exposes exec fork, --ephemeral, --sandbox read-only, --ignore-user-config, --ignore-rules, --json, and queue --thread --message. queue help says a failed --resume can still succeed; this design does not use --resume.
- Read-only process inspection found a live app-server with multiple open rollout files under /home/marius/.codex and state_5.sqlite. Executing that process's binary with --version reports 0.160.0. Another process, /usr/lib/chatgpt/resources/codex app-server --listen stdio://, reports 0.169.0-alpha.11.1 and had no open rollouts in this snapshot. These observations do not establish which desktop surface a process serves. The actual task-list tool identifies this task as 01a1e3b2-8704-7042-9dc9-03f8e7e3fb31, and that exact UUID appears among the 0.160.0 daemon's open rollouts. Do not equate an app-server process with a thread, or the installed CLI version with the running host version.
- On this Linux host, ~/.Codex, ~/.Codex-sdd and ~/.Codex-kat are absent; ~/.codex exists. Do not create absent profiles.
- codex plugin list --json timed out; plugin discovery through that command is not yet established. Local hooks.json already contains another plugin's hook and must be preserved.

## Implementation and installed-host verification — 2026-11-16

The Rust adapter, MCP send_message tool, hook/filter support and preserving installer are implemented. Existing Codex home /home/marius/.codex is configured; the three uppercase profile roots are absent and were not created. The release bridge binary is installed for Claude Code as well. After the user's Codex restart, all four native MCP tools are loaded and list_sessions marks this original task as self. hooks/list reports all three session-bridge handlers enabled and trusted without changing trust settings.

Managed daemon 0.160 plus CLI 0.169 passed a real read-only fork/context/history smoke and a disposable original-thread send with exact consumption and native reply. A separate strace probe observed the fork's actual attempted file creation denied with EROFS. Official interactive Claude 2.1.325 successfully invoked send_message for this task's original Codex thread and initially got queued. The exact message sb-1794828795733644958-2899021-0 later arrived in this original thread with SESSION_BRIDGE_CLAUDE_INTERACTIVE_OK, confirming Claude-to-original-Codex delivery without retry.

The live Claude probe exposed a missing optional-IPC boundary: native Claude writes its current per-PID registration without a socket. Discovery and caller ancestry now read that registration for native Claude, retaining legacy socket compatibility. Startup session environment is not authoritative after /clear. Explicit request metadata wins; a nearer validated Claude caller beats inherited Codex variables, while an intervening loaded Codex host prevents selection of an outer Claude ancestor. Fixture regressions and applied mutations pin these boundaries.

Post-restart managed-host activation passed. In a private temporary git repository, sender 01a1e446-1dd4-7962-892c-c49f0ddb0753 posted notice 4; receiver 01a1e446-2f36-75a2-8a8f-10da3614ea40 read it after the existing 120-second interval, obtained a relevant filter verdict, received additionalContext through a completed UserPromptSubmit hook, and replied with BRIDGE_HOOK_NOTICE_20261116_A7. That signal was absent from the receiver prompts. Final state recorded delivered=[4], both owned threads were archived, and only the test notice/state/repository were cleaned. Evidence: task workspace notice-live-smoke.json. Earlier negative probes checked too soon (session log F-4); no bridge code change was needed.

Still unverified: the separate desktop stdio host, which has no discovered open rollout. It is not certified by the managed-daemon results. Managed-host implementation, installation and activation are verified; whole-surface acceptance remains partial until that distinct host has an available test thread.

## Approaches

1. Extend the Rust MCP server with a Codex adapter (selected engineering proposal). Reuse the notice store and Claude behavior; add harness-specific identity, discovery, child invocation and hook normalization.
2. Build a separate Codex-only bridge. Duplicates storage, routing and public tools and makes cross-harness delivery a second integration.
3. Patch Codex to add a bespoke endpoint. Rejected by the user's explicit constraint.

Use the first approach. This is a multi-step plugin change, not a modification of the Codex host.

## Public behavior

| Tool | Claude target | Codex target |
| --- | --- | --- |
| list_sessions | Existing live discovery | Loaded thread discovery, separately identified |
| ask_session | Existing isolated Claude fork | Ephemeral read-only Codex fork |
| send_message (new) | Explicit unsupported-target error in this change | Queue a labeled message into the original loaded thread |
| post_notice | Existing repository notices | Same channel, with Codex author identity and delivery |

Existing Claude target strings continue to work. Codex rows include harness, full config root, PID and complete thread UUID. Canonical Codex addressing includes the full config root and thread UUID; a convenient short profile/UUID form may resolve only when unambiguous. Names and prefixes are conveniences, never a way to select the first ambiguous match. Self-targeting is refused.

send_message(target, message, timeout_s?) is explicitly different from ask_session: it may cause the target to run its normal tools and consume its normal account budget. It has no model override. It does not interrupt a busy turn or change the thread's model or permissions. Direct sending to Claude is outside this change.

## Identity and discovery

Introduce a harness-aware endpoint identity containing harness, canonical config root, PID and session/thread ID. Persist Codex state per thread, not per host PID. Existing Claude state and notice rows stay readable; legacy identities are interpreted as Claude.

Resolve a Codex caller from host-provided MCP request context when available, then validate it against discovery. The installed source inspected read-only uses MCP metadata key threadId. An exact inherited CODEX_THREAD_ID may be supported when it is independently validated. Never choose a caller from a last-writer file, another thread's environment, or the first thread in a process. Missing/ambiguous caller identity must be explicit for mutating calls; list_sessions may still list without a (you) mark.

Codex discovery is Linux-local: inspect app-server processes, read each process's own CODEX_HOME (fallback: that process's HOME/.codex), and identify loaded threads by open rollouts. Read the corresponding state database read-only for names and thread cwd, using bounded busy timeouts; never create a missing DB. A missing schema/metadata produces explicit unknown fields, not invented cwd/status. Verify UUIDs, skip archived entries, deduplicate repeated FDs, and isolate failures per profile. This adapter supports the observed rollout-backed layout; unsupported history layouts are surfaced as incomplete discovery. A saved database row by itself is not a loaded thread.

Derive the notice repository from the calling thread's cwd, not the app-server's process cwd. Revalidate the selected thread/process/config root immediately before a send or fork.

## Read-only questions

Keep the existing Claude subprocess path. Add a Codex child invocation using the installed exec fork interface with the target account, an ephemeral fork, read-only sandbox, no approvals, and no bridge recursion. Launch with an argument vector and an absolute resolved executable; support SESSION_BRIDGE_CODEX_BIN as an absolute override.

The fork must not inherit writable MCP tools, plugins, hooks or unsafe execution rules. Establish the exact isolation flags/config with installed help plus an executable negative test before enabling this path. If installed Codex cannot enforce the boundary, return an explicit unsupported error for Codex ask rather than weakening it. No Codex source change is an acceptable fallback.

Use bounded stdout/stderr capture, bounded timeout and child cleanup. Require successful exit and an observed completed answer, not merely some JSON on stdout. Parse Codex JSONL answer and token usage. A Codex USD cost absent from the output is null/unknown, never zero or inferred from Claude pricing. Do not apply Claude model aliases or the Claude USD meter to Codex. Omitted model uses the Codex account's supported default; a caller-supplied Codex model ID is passed literally. Record usage and unknown cost honestly. Retain the Claude accounting contract for Claude targets.

## Direct messages into Codex

Use codex queue with the exact UUID, the target's CODEX_HOME, and one message argument. Do not use --resume. Require that the target was discovered loaded and revalidate it immediately before spawning. Do not intentionally queue to a dormant saved thread.

Label the text with bridge message ID, sender identity and timestamp. Treat peer text as data, never approval. Reject empty/oversized text and unsafe IDs; never interpolate peer text into a shell command.

Return structured evidence: target, message ID, queued/observed/unknown status, timestamp, and diagnostic reason. Exit 0 from queue establishes only queued. An observed status requires that exact unique message marker in newly appended target transcript records; unrelated file growth is insufficient. A bounded observation timeout returns queued or unknown according to the evidence already obtained. Rejection before enqueue is an error; a failure after possible enqueue is unknown. Never retry automatically after possible enqueue. A race where the thread unloads after validation may leave a queued message; report that uncertainty honestly. Do not claim the target answered unless its answer was correlated separately.

## Repository notices

Both harnesses share notices.db and repository grouping, retention, sanitization and peer-data labeling. Add thread-aware author identity and self-exclusion so sibling Codex threads can receive one another's notices. Preserve legacy Claude semantics.

Normalize Codex hook payloads into an internal input with exact thread identity, cwd, transcript and event. Emit the installed hook protocol through a Codex wrapper, preserving the fail-open behavior. Skip subagents and bridge-created forks. Register SessionStart, UserPromptSubmit and PostToolUse where supported; verify the installed host actually consumes additional context. Preserve every unrelated installed hook and its trust state.

Extend transcript extraction for Codex user/assistant text without counting tool output, harness instructions or duplicate event/response representations as user speech. A Codex receiver must not silently bill an arbitrary Claude profile for filtering: use an isolated Codex filter under its own account, or deliver with an explicit unfiltered reason when that adapter is unavailable. Keep the existing Claude filter for Claude receivers. Neither passive notice delivery nor a hook spawns a direct-message wake loop.

## Installation and compatibility

Provide documented Codex MCP registration and an idempotent hook renderer/installer within session-bridge. Inspect existing profiles and merge only this plugin's entries, preserving unrelated settings. Do not bypass Codex hook trust, replace shared Codex binaries, restart other sessions, or create missing profile roots. Verify source/install paths against each owning config root.

Keep release/version changes separate from feature implementation and use the repository release workflow if a release is requested/required. No manual version bump in a feature edit. A current running session may need a new MCP connection/reload to see new tools; distinguish fixture validation from installed live validation.

## Verification and acceptance

1. Existing Claude bridge tests remain green; cargo fmt, cargo test and cargo clippy -D warnings pass.
2. Fixtures cover multiple Codex threads in one PID, multiple account roots, same names, ambiguous IDs, missing/locked DB, archived/dead threads, no open rollout, and caller metadata mismatch.
3. Actual MCP request tests pin tool schemas and caller identity, including Claude → Codex routing and Codex-origin posting into the correct repository.
4. Apply candidate mutations to thread identity, account routing, loaded-thread guards, read-only child flags and message confirmation; observe which tests fail, then restore. Report measured surviving counts.
5. Executable fake-Codex tests cover exact argv/env, literal shell metacharacters, nonzero exits with plausible JSON, timeout/cleanup, truncated output, missing completion, and unknown monetary cost.
6. Direct-send tests cover queued-but-not-observed, unrelated transcript growth, exact marker confirmation, unload races and no resend.
7. Hook/transcript tests pin Codex context output, root/subagent discrimination, duplicate suppression and thread-isolated cursors.
8. An isolated real Codex smoke proves a fork cannot write and leaves the original history unchanged; a separate disposable original thread proves an actual direct queued message is consumed. An isolated Claude caller invokes the real bridge tool for Claude → Codex. Use only disposable test sessions, never unrelated live peers. Run acceptance separately for each selected Codex surface/runtime; a CLI-only result does not certify desktop delivery. A required capability returning unsupported means unfinished/blocked work, not successful scope reduction.
9. Installation dry runs prove an existing hook survives and absent profiles remain absent. Report any missing host capability as a limitation; do not modify Codex to make a test pass.

## Builder choices

Module boundaries, internal key encoding, additive SQLite migration mechanics and bounded parser implementation are engineering choices. Preserve the identity, isolation and evidence contracts above. If a required installed-host boundary fails, document it and return explicit unsupported behavior at runtime, but keep the requested capability outstanding. Never mark the feature complete based on that fallback. The user approved implementation on 2026-11-16. Engineering assumption: cover terminal and desktop threads where reachable through installed transports, and verify each separately. Required capabilities remain outstanding if a host boundary prevents them; no host-source changes or silent scope reduction.
