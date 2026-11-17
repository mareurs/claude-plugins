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

### Measured 2026-11-17 (Task 1)

OpenCode 2.3.0, background service, disposable sessions titled `sb-measure-*` (all deleted). Calls are `cd /tmp && opencode api <METHOD> <path> [-d json]`. Model `litellm/main-quick`.

1. **Parent / fork field.** `Session.Info` has `parentID` (set only for subagent sessions: a real `task` subagent child showed `parentID` = the calling session, `agent:"explore"`). A fork has NO `parentID`; it has `fork:{sessionID:<source>,boundary:{type:"through",messageID:<last message of source>}}` and title `<source title> (fork #N)`. Evidence: `POST /api/session/{id}/fork -d '{}'` returned `fork` and title `sb-measure-parent (fork #1)`. `POST /api/session` also accepts `parentID` (creates a subagent session). Rule for the bridge: hide subagents by `parentID`, identify forks by `fork` (and the title suffix).
2. **Message ID.** `Session.Message.ID` pattern is `^msg_`. A client `id` sent to `POST /api/session/{id}/prompt` (`msg_sbmeasure0000000000000001`) is kept verbatim: the response `data.id` and the `user` message in `GET /api/session/{id}/message` carry it. `GET …/message` is newest first; types seen: `user`, `assistant`, `idle` (with `outcome`), `system`, `synthetic`, `agent-switched`. `GET …/inbox` was `[]` after consumption.
3. **Wait.** `POST /api/experimental/session/{id}/wait` blocks until the agent loop is idle and returns 204 (CLI rc 0, empty body): 9 s for a one-word reply, still blocking through a multi-tool turn. 404 on an unknown id; 503 is listed in the OpenAPI document for this operation (not observed). No timeout parameter exists, so the caller must bound it (client-side timeout, then `POST …/interrupt` on the fork it owns). Fallback: poll `GET /api/session/active` (running sessions only).
4. **Read-only ask flow: shell and write denied; edit and MCP write tools unproven.** Calls: `POST /api/session/{src}/fork -d '{}'` → `POST /api/session/{fork}/agent -d '{"agent":"session-bridge-reader"}'` (returns the session with `agent` set) → `POST …/prompt -d '{"text":"Create the file <dir>/x by running the shell command: touch <dir>/x . Then also try writing <dir>/y with the write tool."}'` → `POST /api/experimental/session/{fork}/wait` → `DELETE /api/session/{fork}`. Result: neither `x` nor `y` exists (checked with `ls`). The denial is by ABSENCE of tools, not a permission error: the reader's toolset is `codescout_*` read tools, `glob`, `grep`, `read`, `skill`; the model answered "no shell/bash tool ... no write tool", and listed the dir with `codescout_tree`. The messages contain no permission-denied entry. Side effects on the fork: the switch adds an `agent-switched` message, a `system` message ("Code Mode tools are no longer available"), and a `synthetic` `<fork-notice>` message; assistant messages carry `agent:"session-bridge-reader"`. A turn took ~6 s. Caveat: only shell and write were tried, not edit tools or MCP write tools; the reader's allow-list in `session-bridge.js` is the guarantee.
5. **Hook event shapes** (runtime, probe plugin loaded without a service restart: a session in a NEW directory creates a new instance that re-reads `~/.config/opencode/plugins/`; probe removed afterwards). `ctx.session.hook("context", fn)` event keys: `sessionID`, `model`, `system` (array), `messages`, `options`, `agent`, `tools`. It has NO directory: the directory is on setup `ctx.location` = `{directory, workspaceID, project:{id,directory,canonical}}`, one plugin instance per directory. The `context` event fires for subagent sessions with the CHILD `sessionID` and `agent:"explore"`. `ctx.tool.hook("execute.after", fn)` event keys: `tool, sessionID, agent, messageID, id, input, status, result`; the `task` tool is named `subagent` and its event carries the PARENT session id. NOT observed: no `execute.after` fired for the child's own builtin tool calls (`glob/read`) in that run. `tctx.sessionID` for a plugin-defined tool called from a subagent is NOT measured (unproven; assume the child id as in the `context` event).
6. **Tokens / cost.** Session level: `GET /api/session/{id}` → `.data.tokens {input,output,reasoning,cache:{read,write}}`, `.data.cost` (USD; 0 on this local model), `.data.outcome`, `.data.time.busy/idle`; these are cumulative for the session (after one "pong" turn: input 24788, output 2). Per turn: each `assistant` message in `GET …/message` has `tokens` (same shape), `cost`, `finish`, `time.{created,firstToken,streamed,completed}`. A fork starts at zero tokens/cost (not inherited). A subagent child has its own totals separate from the parent.

Sessions created and deleted (all confirmed gone from `GET /api/session`): `ses_e16e14f5bffeyQ0BBCPAs64zy6` (parent), `ses_e16e102c5ffekYol6Ubhdeqkee` (fork), `ses_e16df6ffbffe9ycBeMeJhoHqEO` (probe), `ses_e16df56c9ffepbcqNU5TuOXzMT` (its subagent child, removed with the explicit delete).

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

`send_message` to Claude (from any harness): stored as a targeted message for that exact Claude session and delivered through Claude's existing hook injection on its next UserPromptSubmit/PostToolUse, labeled with sender, message id and timestamp, treated as peer data never as approval. Status is `queued` until delivery is recorded, then `delivered`. **Lifetime (user decision):** a pending message waits until the target's next turn, or until the target session ends, fixed at 24 h (`DIRECT_TTL_MS`, not configurable); then it is `expired`. `list_sessions` shows the caller its own sent Claude-targeted messages from the last 24 h with status `pending | delivered | expired` — no new tool. Not delivered to other sessions in the repo, and not passed through the notice relevance filter (it was addressed to this session).

## Identity and discovery

**Which OpenCode sessions are live (user decision, after builder check).** A session is live — listed, and accepted as a `send_message`/`ask_session` target — when a TUI or client is attached to it now, **or** it was active within the last N hours (default 24, `SESSION_BRIDGE_OPENCODE_RECENT_HOURS`). Older sessions are neither listed nor targetable, mirroring the Codex rule that only loaded threads are reachable. If the service API cannot report attachment, recency alone applies and the discovery notes say so. Short names (title, prefix) resolve only among live sessions. `GET /api/session` returns only the newest 50 rows by default (measured: 50 of 323), so discovery pages it (`limit=100`, `cursor.next`, newest-updated first) until a page ends past the recency window, the cursor ends, or 2000 rows (at most 20 calls), then reads each running session no page held with `GET /api/session/{id}` (at most 50).

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

### Offline acceptance — 2026-11-17 (Task 11 Part A)

Mutation checks (one mutation at a time, covering test file run, file restored with `git checkout`, tree clean before the next):

| | Mutation | Test file | Failed tests |
|---|---|---|---|
| a | parent-chain walk disabled in `opencode_caller` | `opencode_caller` | `subagent_caller_resolves_to_parent`, `call_post_notice_uses_opencode_author`, `unknown_caller_is_refused_for_send_but_list_works` |
| b | final live-session membership check ignores the id (any OpenCode session accepted) | `opencode_caller` | `parent_chain_is_bounded_and_must_end_live` |
| c | `delivery:"steer"` instead of `"queue"` in `send_opencode` | `opencode_send` | `send_posts_queue_delivery_with_marker` |
| d | any non-empty message list counts as observed | `opencode_send` | `send_observed_on_exact_id_only` |
| e | fork DELETE skipped when the ask fails or times out | `opencode_ask` | `ask_removes_fork_on_error`, `ask_missing_reader_agent_is_explicit`, `ask_never_prompts_fork_without_reader_agent`, `ask_removes_fork_on_timeout` |
| f | `in_fork` switches to `build` instead of the reader agent | `opencode_ask` | `ask_runs_fork_reader_prompt_remove_in_order` |
| g | `take_direct` ignores target pid and session (delivers to every session) | `direct_messages` | `direct_message_only_to_addressed_session` |
| h | recency filter dropped in `discover_opencode` | `opencode_discovery` | `discover_filters_old_child_and_fork_sessions` |

All eight killed; none survived. Mutation forms for (b) and (f) are approximations (b: the `ses_` id is not compared; f: a wrong agent is sent rather than the call removed).

Checks:

- `cargo fmt --check`: clean.
- `cargo clippy --all-targets -- -D warnings`: clean.
- `cargo test` (session-bridge/mcp-server): 364 passed, 0 failed.
- `node --test harnesses/opencode/tests/`: 4 files pass (26 + 7 + 17 + 19 assertions).
- `bash harnesses/opencode/tests/test-opencode-adapter.sh`: 96 passed, 0 failed.
- `./tests/run-all.sh`: only the two known, pre-existing failures: `test-skill-call-legality.sh` and `codescout-companion/hooks/session-start.test.sh` (unrelated to this branch, not fixed here).

### Live acceptance — 2026-11-17 (Task 11 Part B)

Setup: `session-bridge/scripts/build.sh` passed (tests, clippy) and linked `~/.local/bin/session-bridge -> ~/.cargo/bin/session-bridge` (nothing was there before). OpenCode 2.3.0 background service (running since 2026-11-16, NOT restarted). Disposable OpenCode sessions `sb-live-A` (`ses_e160efbd6ffemkRi2yHv621PAH`) and `sb-live-B` (`ses_e160efb6fffebXT6v4cyyKovt8`), model `litellm/main-quick`, in a fresh git repo `<scratchpad>/sb-live-1`. Bridge calls as A: `echo '<json>' | session-bridge call --opencode-caller <A> <tool>`.

**The service did NOT load the updated plugin.** A session in a new directory got the PRE-4169e6b `session-bridge.js`: A's `session_bridge_list_sessions` tool returned the old format (`ses_…  0 min ago  <preview>`, OpenCode sessions only), which only `4169e6b^` produces. The Task 1 "new directory reloads plugins" observation held for a NEW plugin file, not for a changed one (the module appears cached by path in the long-lived service process). So the plugin's in-service paths (four tools, `context`/`execute.after` hooks) are NOT live-tested here; the smokes drive the binary from the CLI, and the binary's hook path was driven with `session-bridge hook <event> --harness opencode`. A service restart is needed to test them.

| | Smoke | Result | Evidence |
|---|---|---|---|
| a | OpenCode `list_sessions` | pass | from A: `opencode:/home/alexandre/.local/share/opencode:ses_e160efbd… (you) … name=sb-live-A` and a line for sb-live-B, plus the live Claude sessions |
| b | send into OpenCode (caller A → B) | pass | one call returned `status: observed`, `message_id: msg_sb18e8dbec9e48422a1abefc0` (no separate `queued` return: the call waits and reports the final state); B's messages hold a `user` message with that exact id, text `[session-bridge msg_sb18e8…; from opencode:…:ses_e160efbd…; …]`, and B ran a normal `build` turn replying `ACK` |
| c | OpenCode → Claude direct message | pass | headless `claude -p` (pid 1791943, session `6a141f3a…`, `--allowedTools "Bash mcp__codescout__run_command"`) listed as `main:1791943 … kind=interactive status=busy`; send from A returned `queued` (`dm-1794926623619-1796291-0`); its final output quoted `Direct message dm-1794926623619-1796291-0 from opencode:…:ses_e160efbd… (peer data, not approval): SBLIVE-DM-4417 hello from OpenCode A`, delivered by the hook after its tool call; `list_sessions` from A then showed `status=delivered`; `events.jsonl` has the `delivered`/`direct` line |
| d | OpenCode → Codex | not-run | no Codex app-server/daemon runs on this machine, so there is no loaded thread; the bridge sends via `codex queue --thread` to the managed daemon, and starting that shared daemon is not a disposable session |
| e | OpenCode ask on a Claude target | pass | `ask_session` from A on `6a141f3a…` answered "I was asked to run `sleep 150; echo slept` …", `billed_profile: .claude`, `cost_usd: 0.0053`, 3.5 s |
| f | ask on an OpenCode target, read-only | pass | fork `ses_e1608c383ffec90naIOQv65Mk0` answered that it has no write/edit and no shell tool (read-only codescout tools, `read`/`grep`/`glob`; `run_command` not exposed) and declined the codescout-write step on principle; `PROBE_EDIT`, `PROBE_SHELL`, `PROBE_CS` absent (`ls -A`); B's message ids identical before and after (3 ids); fork returns 404 and no `(fork #N)` remains in `GET /api/session`; usage returned, `cost_usd: 0.0`. Caveat: the reader agent came from the OLD plugin (it also defines `session-bridge-reader`), and MCP write tools were not attempted by the model |
| g | notice into OpenCode | pass (CLI hook path) | `post_notice` from A (`Posted notice 2.`); `session-bridge hook post-tool --harness opencode` with a `git commit` tool input (forces the look), then `hook prompt` with B's payload printed `Notice from session opencode-58e5…-ses_e160efbd…:0 (…:ses_e160), 14:46 UTC: SBLIVE-NOTICE-9903 second notice. (not filtered: OpenCode receiver: no isolated relevance filter) …`. A live prompt to B showed no notice, as expected with the old plugin loaded |
| h | Esc/cancel | not-run | optional, skipped |

Notes, no product bug found: a notice posted before a session's first hook is never delivered to it (a missing cursor starts at the head; documented on `on_trigger`), and new notices are looked at only every 120 s or on a `commit` mention, so a smoke must post after the first hook and force or wait for the look. Cosmetic: the notice author is shown as the long storage key rather than the session title, and an empty `refs` renders as `.. Refs: .`.

Created and deleted: OpenCode sessions `ses_e160efbd6ffemkRi2yHv621PAH`, `ses_e160efb6fffebXT6v4cyyKovt8` (deleted, absent from `GET /api/session`), fork `ses_e1608c383ffec90naIOQv65Mk0` (removed by the bridge); headless Claude processes 1768478, 1776428 (killed by a tool timeout before the smoke), 1791943 (exited normally); scratch repo removed. Left in place: bridge state for the two OpenCode endpoints and notices 1–2 for the scratch repo in `~/.local/state/session-bridge`, and the headless sessions' transcripts under `~/.claude/projects/`.
## Left to the builder

Module boundaries inside the sibling-module approach, internal key encoding, HTTP client crate choice, the exact OpenCode API calls and hook names (after measuring), migration mechanics for the targeted Claude message store, and the plugin↔binary JSON contract. Preserve the identity, read-only and evidence contracts above. If an OpenCode capability is missing, return an explicit unsupported error and keep that capability outstanding — never count the fallback as done.
