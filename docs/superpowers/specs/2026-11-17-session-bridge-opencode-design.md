---
id: '1a58e4dcb3e0f9cf'
kind: spec
status: approved
title: 'Session bridge: OpenCode and cross-harness interoperation'
owners: []
tags:
- session-bridge
- opencode
- cross-harness
topic: null
time_scope: null
---

# Session bridge: OpenCode and cross-harness interoperation

## Intent and user decisions

Make OpenCode a full harness of session-bridge, beside Claude Code and Codex, so that Claude ↔ OpenCode and Codex ↔ OpenCode sessions can find, ask, message and notify each other through one backend. Ships to **marketplace users**, not only this machine.

Decisions the user made (2026-11-17 brainstorm):

- **Follow session-bridge's existing design.** OpenCode sits behind the same four tools — `list_sessions`, `ask_session`, `send_message`, `post_notice` — with the same meaning they have for Codex. No spawn, wait, stop, concurrency cap, viewer or run logs. kb-peer is not a reference for this design and will be discarded; nothing is ported from it.
- **Claude/Codex → OpenCode `send_message`:** starts a real turn in the existing, original OpenCode session (its own model, agent, permissions), like Codex send. No session creation.
- **`ask_session` on an OpenCode target:** an ephemeral read-only fork, deleted after the answer — same contract as Codex.
- **OpenCode → Claude:** a `send_message` to a Claude target is delivered as a message injected through Claude's hooks at that session's next turn (a notice-style, targeted delivery). An idle Claude session is not woken. OpenCode callers can also `ask_session` Claude and Codex targets.
- **Notices:** OpenCode sessions **receive** repository notices (announcing-changes) like Claude and Codex; they may also post them through `post_notice` since that is one of the four tools.
- **OpenCode caller path:** the existing OpenCode plugin (`harnesses/opencode/plugins/session-bridge.js`) is the front end. Its tools call the Rust `session-bridge` binary, passing the caller's `ses_` id that OpenCode gives every plugin tool call (`tctx.sessionID`). No MCP registration inside OpenCode.
- **The OpenCode-only bridge is absorbed.** OpenCode → OpenCode list/ask also goes through the Rust backend. The JS plugin keeps thin tool wrappers, the `session-bridge-reader` agent, the no-recursion guard and notice delivery.
- **OpenCode server:** discover the running OpenCode background service; if none, start it.
- **Pi is out of scope**; the harness-aware identity must leave room for it.

## Current evidence

- Rust MCP server (`session-bridge/mcp-server`) exposes `list_sessions`, `ask_session`, `send_message`, `post_notice` (`src/server.rs`). Harnesses: Claude Code and Codex. Codex was added as sibling modules `codex.rs`, `codex_process.rs`, `codex_hook.rs` (spec `2026-11-16-session-bridge-codex-design.md`, approved). `send_message` to a Claude target currently returns an explicit unsupported error.
- Identity is already harness-aware since the Codex change (harness, config root, PID, session/thread id); Codex addresses are `codex:<CODEX_HOME>:<uuid>`.
- `harnesses/opencode/plugins/session-bridge.js` (232 lines), symlinked into `~/.config/opencode/plugins/`, gives OpenCode sessions `session_bridge_list_sessions` (via `ctx.session.list`) and `session_bridge_ask_session` (spawns `opencode run --standalone --format json --agent session-bridge-reader --fork -s <id> <prompt>`, then `ctx.session.remove` on the fork). It registers a hidden `session-bridge-reader` agent (`* deny`, then read/grep/glob/list/skill and read-only codescout tools allowed, `.env` reads denied), because the built-in `plan` agent is not read-only (measured on 2.1.3: it can run shell). `OPENCODE_SESSION_BRIDGE_CHILD=1` stops forks from registering bridge tools. Tool calls receive `tctx.sessionID` and `tctx.signal`; self-ask is refused.
- Installed OpenCode on this machine: **v2.3.0**. It runs a shared **background service** (`opencode service start|status|stop…`); the TUI, `run`, `session` and `api` subcommands connect to it unless `--standalone` or `--server <url>` is given. `opencode service status` printed `http://127.0.0.1:49374`. `~/.config/opencode/service.json` holds a `password` (the service is authenticated). `opencode api <operationId | METHOD path>` makes requests against an OpenAPI surface. Sessions live in `~/.local/share/opencode/opencode.db`.
- Not yet measured: the HTTP operations for listing sessions with status, sending a prompt without blocking (prompt_async or equivalent), session busy/idle state, fork through the API, the auth header format, and which plugin hooks can inject context into the next turn. The builder measures these first (see Verification).

## Approaches

1. **Sibling module in the Rust server (selected by the user).** Add `opencode.rs` (service discovery/start, authenticated HTTP client, list, prompt, fork, delete) and `opencode_hook.rs` (plugin-to-binary contract for caller identity and notice intake), extend `sessions.rs`, `send.rs`, `server.rs`, `main.rs` CLI. Follows the pattern that already works for Codex; Claude and Codex paths stay untouched.
2. **Harness trait refactor first.** A `Harness` trait with Claude, Codex, OpenCode implementations. Cleaner for a fourth harness (Pi), but rewrites the working Codex/Claude paths and enlarges the change. Rejected for now.
3. **External TypeScript adapter** using OpenCode's SDK behind a CLI contract. Easier API work but adds a second runtime and process boundary. Rejected.

Caller side, two options were weighed: register the Rust MCP server inside OpenCode (caller `ses_` id unmeasured, duplicates the plugin's tools) versus **plugin tools calling the Rust binary with `tctx.sessionID` (selected)** — verified identity comes from the host for free.

## Public behavior

| Tool | Claude target | Codex target | OpenCode target |
| --- | --- | --- | --- |
| list_sessions | existing | existing | sessions of the OpenCode service, separately identified |
| ask_session | existing isolated fork | existing read-only fork | ephemeral read-only fork under `session-bridge-reader`, deleted after |
| send_message | **new:** queued, injected at the Claude session's next turn via its hooks | existing | prompt into the original session, starting a normal turn |
| post_notice | existing | existing | same channel; OpenCode author identity and delivery |

All four tools work from all three harnesses as callers (OpenCode callers through the plugin). Self-targeting is refused. Canonical OpenCode address: `opencode:<service identity>:<ses_id>` — the builder picks the service identity component (e.g. the data dir or service URL) so two OpenCode installs on one machine never collide. Short forms (`ses_` id, prefix ≥ 4 chars, title) resolve only when unambiguous.

`send_message` to OpenCode: does not interrupt a busy turn (if the session is busy, either queue per OpenCode's own semantics or return an explicit busy error — builder measures which OpenCode offers and documents it), does not change model/agent/permissions, has no model override, and never targets a deleted or archived session. Same return evidence as Codex: target, message id, `queued|observed|unknown`, timestamp, reason. `observed` requires the exact bridge message marker in that session's new messages. No automatic retry after a possible enqueue.

`send_message` to Claude (from any harness): stored as a targeted message for that exact Claude session and delivered through Claude's existing hook injection on its next UserPromptSubmit/PostToolUse, labeled with sender, message id and timestamp, treated as peer data never as approval. Status is `queued` until delivery is recorded, then `delivered`. **Lifetime (user decision):** a pending message waits until the target's next turn, or until the target session ends, capped at 24 h (configurable); then it is `expired`. `list_sessions` shows the caller its own sent Claude-targeted messages from the last 24 h with status `pending | delivered | expired` — no new tool. Not delivered to other sessions in the repo, and not passed through the notice relevance filter (it was addressed to this session).

## Identity and discovery

**Which OpenCode sessions are live (user decision, after builder check).** A session is live — listed, and accepted as a `send_message`/`ask_session` target — when a TUI or client is attached to it now, **or** it was active within the last N hours (default 24, `SESSION_BRIDGE_OPENCODE_RECENT_HOURS`). Older sessions are neither listed nor targetable, mirroring the Codex rule that only loaded threads are reachable. If the service API cannot report attachment, recency alone applies and the discovery notes say so. Short names (title, prefix) resolve only among live sessions.

**Subagent callers (builder-check call, Claude's decision).** When `tctx.sessionID` names a child/subagent session, the binary resolves it to its top-level parent session and treats that as the caller (self-targeting refusal, sender label, ask accounting). Child sessions are never listed or targetable.

- Extend the harness-aware endpoint identity with `harness = opencode`, service identity and `ses_` id. Persist OpenCode state per session.
- **OpenCode callers** are identified only by the plugin passing `tctx.sessionID` to the binary; the binary validates that the id exists in the discovered service before any effect. A missing or unknown id is an explicit error for mutating calls; listing still works without a `(you)` mark. The binary must not accept an OpenCode identity from anything but this path (no last-writer file, no environment inherited from another session).
- **Discovery:** read the background service URL and credential the way OpenCode itself does (`service.json`, `opencode service status`, or the documented equivalent — builder measures, prefers a stable file/API over parsing human output). If no service is reachable, start it with `opencode service start` (never `--standalone`, never a private server), then retry once with a bounded wait. Never stop or restart a service the bridge did not start. If OpenCode is not installed, OpenCode rows are simply absent and an explicit discovery note says why.
- List top-level sessions with id, title, directory, and live status (busy/idle) when the API exposes it. Skip child/subagent sessions and bridge-created forks (marked by the reader agent or `OPENCODE_SESSION_BRIDGE_CHILD`). A session row in the DB is not proof a UI is attached; say so in the discovery notes, as for Codex.
- The notice repository for an OpenCode session is derived from that session's directory, not the service's cwd.
- `SESSION_BRIDGE_OPENCODE_BIN` overrides the OpenCode executable (absolute path).

## Read-only questions into OpenCode

**Budget (builder-check call, Claude's decision).** Asks on OpenCode targets are outside the Claude USD daily meter (`ask.rs` `DAILY_BOUND_USD`), exactly as Codex asks are: report token usage when available, cost `null` when unknown, never charge `FAILED_ASK_CHARGE_USD` or an invented estimate. Asks from an OpenCode caller to a Claude target remain metered under the existing Claude rules.

Reuse the existing fork mechanism and the `session-bridge-reader` agent, moved behind the Rust binary: fork the target, run the question under the reader agent with `OPENCODE_SESSION_BRIDGE_CHILD=1`, collect the final answer, delete the fork. Prefer doing this through the service API if it supports fork + prompt + delete under a chosen agent; otherwise invoke `opencode run --fork` as an argv (no shell). The fork must not be able to write files or run commands: prove it with an executable negative test before enabling. If the boundary cannot be enforced, return an explicit unsupported error rather than weaken it.

The reader agent is registered by the OpenCode plugin, so `ask_session` on an OpenCode target requires the plugin installed; without it return an explicit error naming the missing plugin. Bounded timeout (existing default/max), bounded output, cleanup of the fork on every path including timeout. Token usage reported if OpenCode provides it; unknown cost is `null`, never zero or Claude-priced. Omitted model uses the target session's model.

## Repository notices into OpenCode

OpenCode receivers get notices through the OpenCode plugin: on the plugin hook(s) that can add context to the next turn (builder measures which — e.g. chat/message or session events), the plugin calls the binary's existing notice-intake path with the session's `ses_` id and directory and injects what it returns. Same store (`notices.db`), grouping, retention, sanitization, peer-data labeling and per-session cursors as Claude/Codex; self-exclusion per `ses_` id. Skip forks and subagent sessions. Fail open: a bridge failure never blocks the OpenCode turn.

Relevance filtering for OpenCode receivers must not bill an arbitrary Claude or Codex account. Use an isolated filter under the receiver's own OpenCode configuration if feasible, otherwise deliver with an explicit `unfiltered` reason — same rule as for Codex.

## Absorbing the OpenCode-only bridge

The JS plugin's `list` and `ask` logic moves into the Rust backend. The plugin keeps: tool definitions (renamed or extended so OpenCode sessions see all four tools), the reader agent registration, the child guard, the notice hook, and a small exec wrapper that calls `session-bridge <subcommand> --caller opencode:<ses_id> --json` with an argv and parses JSON. Remove the plugin's own `runFork`/`listSessions` code paths once the Rust path passes. Existing OpenCode plugin tests in `harnesses/opencode/tests/` are updated, not dropped.

## Installation and compatibility

**Distribution (user decision).** The `session-bridge` binary lives at a stable location on PATH (e.g. `~/.local/bin/session-bridge`), installed or re-linked by every release/install so it never points at a stale versioned cache. The OpenCode plugin finds it via `SESSION_BRIDGE_BIN`, else PATH, and reports a clear error if absent. OpenCode-only users are supported: no Claude Code or Codex install is required. The plugin itself is installed by `harnesses/opencode/install.sh`; the builder makes that work from a marketplace install, not only a repo checkout.

- `harnesses/opencode/install.sh` (existing) installs the plugin; extend it, or add an installer step, so that it also places the `session-bridge` binary (built by session-bridge's `scripts/build.sh` / release) at the stable PATH location described above. Idempotent; preserve unrelated OpenCode config and plugins; never edit `opencode.json` beyond what is needed.
- Marketplace users: README section "OpenCode" listing requirements (OpenCode version range, plugin installed, background service), addressing, what each tool does per target, and the limits. Supported OpenCode range starts at the version measured (2.3.0); earlier versions are refused with a clear message if the needed API is missing.
- Platforms: only Linux is measured. Per the repo's skill/doc rule, other OS are documented as unmeasured, not guessed.
- Release via `scripts/release.sh`; no inline version bumps. A live session needs an MCP reconnect (Claude/Codex) or OpenCode restart (plugin) to see new tools.

## Verification and acceptance

1. **Measure first**, recorded as evidence in this spec: the OpenCode 2.3.0 service API for list/status, non-blocking prompt, fork, delete, auth; plugin hooks that inject context; whether `tctx.sessionID` is present on every tool call including from subagents.
2. Existing Claude and Codex tests stay green; `cargo fmt`, `cargo test`, `cargo clippy -D warnings`; OpenCode plugin tests pass.
3. Fixture/fake-server tests: no service then start, auth failure, unknown/ambiguous `ses_` ids, two OpenCode installs, busy target, deleted session, fork cleanup on timeout, caller id mismatch, shell metacharacters in messages passed literally.
4. Claude-target `send_message`: queued, delivered exactly once at next hook, only to the addressed session, cursor isolation, no relevance filter.
5. Mutation checks on caller validation, address resolution, read-only fork enforcement, message-observed confirmation and Claude targeted delivery: break each, see a test fail, restore.
6. Real smokes with disposable sessions only: Claude → OpenCode send consumed in the original session; OpenCode → Claude send injected at next turn; OpenCode → Codex send; OpenCode ask on a Claude and a Codex target; Claude ask on an OpenCode target with a proven write/exec denial and unchanged original history; a notice posted from Claude received in an OpenCode session.
7. Installer dry run preserves unrelated OpenCode plugins/config.

## Left to the builder

Module boundaries inside the sibling-module approach, internal key encoding, HTTP client crate choice, the exact OpenCode API calls and hook names (after measuring), migration mechanics for the targeted Claude message store, and the plugin↔binary JSON contract. Preserve the identity, read-only and evidence contracts above. If an OpenCode capability is missing, return an explicit unsupported error and keep that capability outstanding — never count the fallback as done.
