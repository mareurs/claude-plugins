---
id: aeadbe4056dc216d
kind: plan
status: draft
title: Session bridge OpenCode interoperation — implementation plan
owners: []
tags:
- session-bridge
- opencode
- cross-harness
topic: null
time_scope: null
---

# Session bridge OpenCode interoperation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenCode a third session-bridge harness behind the existing four tools, so Claude, Codex and OpenCode sessions can list, ask, message and notify each other.

**Architecture:** Sibling modules in the Rust server (`opencode_api.rs`, `opencode.rs`, `opencode_send.rs`, `opencode_ask.rs`, `opencode_hook.rs`) beside the Codex ones, plus a `Session::OpenCode` variant. The Rust side talks to the OpenCode background service through the `opencode api` CLI subprocess (it already resolves the service URL and its password). OpenCode sessions call the bridge through the existing OpenCode plugin, whose tools exec `session-bridge call <tool> --opencode-caller <ses_id>`. Claude-targeted `send_message` becomes a stored direct message delivered by Claude's existing hook path.

**Tech Stack:** Rust (tokio, rmcp, clap, rusqlite, serde_json — no new crates), OpenCode 2.3.0 plugin API (ESM JS), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-17-session-bridge-opencode-design.md` (artifact `1a58e4dcb3e0f9cf`). Predecessor pattern: `docs/superpowers/specs/2026-11-16-session-bridge-codex-design.md`.

## Global Constraints

- Same four public tools only: `list_sessions`, `ask_session`, `send_message`, `post_notice`. No spawn/wait/stop tools. Nothing ported from kb-peer.
- OpenCode floor: 2.3.0. Linux only measured; other OS documented as unmeasured.
- Canonical OpenCode address: `opencode:<canonical OpenCode data dir>:<ses_id>`; data dir = `$XDG_DATA_HOME/opencode` else `$HOME/.local/share/opencode`, canonicalized. Short forms (`ses_` id, prefix ≥ 4 chars, title) resolve only when unambiguous among live sessions.
- Live OpenCode session = top-level (no parent), not a bridge fork, and `max(time.updated, time.viewed)` within `SESSION_BRIDGE_OPENCODE_RECENT_HOURS` (default `24`) **or** present in `session.active`.
- `SESSION_BRIDGE_OPENCODE_BIN` = absolute OpenCode executable override; `SESSION_BRIDGE_BIN` = plugin's override for the bridge binary, else PATH.
- Subagent caller → resolved to its top-level parent session. Child sessions are never listed or targetable.
- OpenCode asks are outside the Claude USD meter (`DAILY_BOUND_USD`); cost `null` when unknown, never `FAILED_ASK_CHARGE_USD`.
- Claude-targeted direct message: delivered once at the target's next UserPromptSubmit/PostToolUse; expires when the target ends or after `24 h`; statuses `pending | delivered | expired`; not filtered for relevance.
- Peer text is data, never approval; argv only, never a shell string; no automatic retry after a possible enqueue.
- Missing OpenCode capability → explicit unsupported error, capability stays outstanding.
- No inline version bumps; release via `scripts/release.sh`.

## Measured facts this plan relies on (OpenCode 2.3.0, 2026-11-17)

- `opencode api <METHOD> <path> [-d json]` reaches the background service; `opencode service status` prints its URL; `opencode service start` starts it. Spec: `GET /openapi.json`.
- `GET /api/session` → `{data:[{id, projectID, model, cost, tokens, outcome, time:{created,updated,busy,idle,viewed}, title, location:{directory}}]}`.
- `GET /api/session/active` → `{data:{"ses_…":{type:"running"}}}`.
- `POST /api/session/{id}/prompt` body `{text, id?, metadata?, delivery?:"steer"|"queue", resume?}` returns at once with `{data: Session.Inbox.User}` (non-blocking). `delivery:"queue"` waits for a running turn; it does not interrupt.
- Also present: `session.get`, `session.fork` (`POST …/fork {before?}` → `Session.Info`), `session.switchAgent`, `session.remove` (`DELETE`), `session.message.list`, `session.inbox.list`, `experimental.session.wait`, `event.subscribe`.
- Plugin API: tool `execute(args, tctx)` gets `tctx.sessionID`, `tctx.signal`; context injection via `ctx.session.hook("context", fn)` pushing `{type:"text", text}` onto `event.system`; `ctx.tool.hook("execute.after", fn)`.

## Review Focus

1. **Many OpenCode sessions (hundreds of rows).** `list_sessions` stays bounded and fast: only live sessions, no per-session API call during discovery. → test `discover_filters_old_child_and_fork_sessions` in Task 3 uses 300 rows.
2. **Title collisions.** Two live sessions titled the same → resolve refuses with both keys, never picks the first. → `resolve_ambiguous_title_refused` in Task 3.
3. **OpenCode service not running / OpenCode not installed.** list still returns Claude/Codex rows plus a discovery note; send/ask return an explicit error. → `missing_binary_lists_others_with_note` in Task 2.
4. **Target becomes busy or ends between discovery and send.** Queue delivery handles busy; a removed session returns a pre-enqueue error, a failure after the POST returns `unknown`. → `send_after_post_failure_is_unknown_not_retried` in Task 5.
5. **Claude target never takes another turn.** The message expires at 24 h or when the Claude session is no longer live, and the sender sees `expired`. → `direct_message_expires_and_is_reported` in Task 7.

---

### Task 1: Measure the remaining OpenCode boundaries and record them

No product code. Throwaway probes in the scratchpad, using **disposable sessions only** (create with `opencode api POST /api/session`, delete after).

**Files:**
- Modify: spec `1a58e4dcb3e0f9cf`, section `## Current evidence` (append a `### Measured 2026-11-17 (Task 1)` block via `artifact(update, body_edits)`).

**Interfaces:**
- Produces: the recorded answers below, which Tasks 3–9 cite by name.

- [ ] **Step 1:** Record the `Session.Info` field that names a parent session (expected `parentID`) and how a fork is distinguishable (title, parent, or metadata) from `GET /openapi.json` and one real fork.
- [ ] **Step 2:** Record the `Session.Message.ID` format (pattern) and whether a client-supplied prompt `id` appears verbatim in `session.message.list` after consumption.
- [ ] **Step 3:** Record whether `experimental.session.wait` blocks until idle (and its timeout semantics); fallback is polling `session.active`.
- [ ] **Step 4:** Prove the read-only ask flow by hand: fork → `switchAgent` to `session-bridge-reader` → prompt "create /tmp/…/x and run `touch`" → wait → confirm no file and a denial in the messages → `session.remove`. Record the exact calls and the denial text.
- [ ] **Step 5:** Record the plugin `context` hook event shape (does it carry `sessionID` and directory?) and whether `tctx.sessionID` in a subagent tool call is the child id.
- [ ] **Step 6:** Record where token usage/cost for a turn is readable (session `tokens`/`cost`, or message parts).
- [ ] **Step 7:** Commit: `docs(session-bridge): record OpenCode 2.3.0 measurements for the bridge`.

If Step 4 cannot be made read-only, stop and report: Task 6 then ships the explicit unsupported error.

### Task 2: OpenCode service client

**Files:**
- Create: `session-bridge/mcp-server/src/opencode_api.rs`
- Modify: `session-bridge/mcp-server/src/lib.rs` (add `pub mod opencode_api;`)
- Create: `session-bridge/mcp-server/tests/opencode_api.rs`
- Create: `session-bridge/mcp-server/tests/fixtures/fake-opencode.py` (records argv to a file, answers from a JSON script keyed by `METHOD path`, supports `service start`)

**Interfaces:**
- Consumes: `codex_process::run_bounded(cmd, timeout) -> Result<Captured>` (generalise its error text to "subprocess", no behavior change).
- Produces:
  - `pub trait OcApi { fn call(&self, method: &str, path: &str, body: Option<&Value>) -> impl Future<Output = Result<Value>> + Send; }`
  - `pub struct CliApi { pub bin: PathBuf, pub timeout: Duration }` implementing `OcApi` via argv `[bin, "api", method, path, ("-d", body_json)?]`; non-JSON or `HTTP nnn` stdout → `Err`.
  - `pub fn locate_opencode(env: &dyn Fn(&str) -> Option<String>) -> Result<PathBuf>` (`SESSION_BRIDGE_OPENCODE_BIN` must be absolute; else PATH).
  - `pub async fn ensure_service(api: &impl OcApi, bin: &Path) -> Result<()>`: `GET /api/session/active`; on failure run `bin service start` once, wait ≤ 10 s, retry once.
  - `pub fn data_dir(env) -> Option<PathBuf>` per Global Constraints.

- [ ] **Step 1:** Write failing tests: `cli_api_passes_body_as_single_argv` (body containing `'; rm -rf /` arrives as one argv element), `cli_api_http_error_is_err`, `ensure_service_starts_once_then_retries`, `ensure_service_never_starts_twice`, `locate_rejects_relative_override`, `missing_binary_lists_others_with_note` (the last one may be completed in Task 3 when the note is rendered — write it here against `locate_opencode` returning `Err`).
- [ ] **Step 2:** Run `cargo test --test opencode_api` → FAIL (module missing).
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Run `cargo test --test opencode_api` → PASS; `cargo test` all green.
- [ ] **Step 5:** Commit `feat(session-bridge): OpenCode service client over the opencode api CLI`.

### Task 3: OpenCode discovery, addressing and the `Session::OpenCode` variant

**Files:**
- Create: `session-bridge/mcp-server/src/opencode.rs`
- Modify: `session-bridge/mcp-server/src/sessions.rs` (variant, `key`, `identity`, `storage_id`, `session_id`, `cwd`, `render`, `discover_sessions`, `resolve_session`)
- Modify: `session-bridge/mcp-server/src/server.rs::list_sessions` and `main.rs` `Sessions` (await OpenCode discovery; render discovery note)
- Create: `session-bridge/mcp-server/tests/opencode_discovery.rs`

**Interfaces:**
- Consumes: `OcApi`, `data_dir` (Task 2); Task 1's parent/fork field names.
- Produces:
  - `pub struct OpenCodeEndpoint { pub data_dir: PathBuf, pub session_id: String, pub title: Option<String>, pub directory: Option<PathBuf>, pub running: bool, pub last_active_ms: i64 }`
  - `impl OpenCodeEndpoint { pub fn key(&self) -> String /* opencode:<data_dir>:<ses> */; pub fn storage_profile(&self) -> String /* "opencode-" + sha256(data_dir)[..16] */; pub fn match_rank(&self, target: &str) -> Option<u8> /* 0 exact key/id/title, 1 prefix ≥4 */ }`
  - `pub fn is_session_id(s: &str) -> bool` (`ses_` + `[A-Za-z0-9]+`)
  - `pub async fn discover_opencode(api: &impl OcApi, data_dir: &Path, now_ms: i64, recent_hours: u64) -> Result<Vec<OpenCodeEndpoint>>` — exactly two calls: `GET /api/session`, `GET /api/session/active`.
  - `pub async fn discover_sessions_all(roots: &Roots, env) -> (Vec<Session>, Vec<String> /* notes */)` — wraps sync `discover_sessions` and adds OpenCode; an OpenCode failure becomes a note, never an error.
  - `Session::OpenCode(OpenCodeEndpoint)`; `storage_id` → `(storage_profile, 0)`; render: `<key>[ (you)] harness=opencode session=<id> name=<title> status=<running|idle> cwd=<dir> repo=<repo>`.

- [ ] **Step 1:** Failing tests: `discover_filters_old_child_and_fork_sessions` (300 rows: 3 recent top-level, 1 old but in `active`, the rest old/child/fork → exactly 4 endpoints), `discover_makes_two_api_calls`, `key_round_trips_and_resolves`, `resolve_ambiguous_title_refused`, `resolve_prefix_needs_four_chars`, `render_marks_running`, `opencode_failure_becomes_note`.
- [ ] **Step 2:** `cargo test --test opencode_discovery` → FAIL.
- [ ] **Step 3:** Implement. Every existing `match` on `Session` gains the arm; Claude/Codex arms unchanged.
- [ ] **Step 4:** `cargo test` all green (existing `sessions`, `server` tests untouched and passing).
- [ ] **Step 5:** Commit `feat(session-bridge): discover and address OpenCode sessions`.

### Task 4: OpenCode callers — `session-bridge call` and shared tool bodies

**Files:**
- Create: `session-bridge/mcp-server/src/tools.rs` (tool bodies moved out of `server.rs`)
- Modify: `session-bridge/mcp-server/src/server.rs` (MCP methods become: resolve caller → call `tools::*`)
- Modify: `session-bridge/mcp-server/src/main.rs` (new `Command::Call { tool: String, #[arg(long)] opencode_caller: String }`, JSON args on stdin, tool output string on stdout, error → stderr + exit 2)
- Modify: `session-bridge/mcp-server/src/opencode.rs` (caller resolution)
- Create: `session-bridge/mcp-server/tests/opencode_caller.rs`

**Interfaces:**
- Produces:
  - `pub async fn tools::list_sessions(caller: Option<&Session>, sessions: &[Session], notes: &[String], state: &Path) -> Result<String>`
  - `pub async fn tools::ask_session(caller: &Session, sessions: &[Session], args: AskArgs, roots: &Roots, state: &Path) -> Result<String>`
  - `pub async fn tools::send_message(caller: &Session, sessions: &[Session], args: SendMessageArgs, roots: &Roots, state: &Path) -> Result<String>`
  - `pub fn tools::post_notice(caller: &Session, args: PostNoticeArgs, state: &Path) -> Result<String>`
  - `pub async fn opencode_caller<'a>(sessions: &'a [Session], api: &impl OcApi, ses_id: &str) -> Result<&'a Session>` — validates `is_session_id`, follows the parent chain via `GET /api/session/{id}` (max depth 8) to the top-level id, then requires a live `Session::OpenCode` with that id; else `Err("OpenCode caller is not a live top-level session")`.
  - `AskArgs`, `SendMessageArgs`, `PostNoticeArgs` move to `tools.rs` (re-exported from `server.rs`); JSON field names unchanged.

- [ ] **Step 1:** Failing tests: `call_requires_valid_ses_id`, `subagent_caller_resolves_to_parent`, `unknown_caller_is_refused_for_send_but_list_works` (list without `(you)`), `call_post_notice_uses_opencode_author` (store row `author_profile` = storage_profile, `author_pid` = 0), `call_args_with_shell_metachars_are_literal`, and existing `tests/server.rs` tool-schema test still passes unchanged.
- [ ] **Step 2:** `cargo test --test opencode_caller` → FAIL.
- [ ] **Step 3:** Move bodies, add `Call`, implement `opencode_caller`. The notice repository for an OpenCode author comes from `Session::cwd()` (session directory).
- [ ] **Step 4:** `cargo test` all green; `tests/fixtures/tool-schemas.json` unchanged.
- [ ] **Step 5:** Commit `feat(session-bridge): OpenCode callers through session-bridge call`.

### Task 5: `send_message` into OpenCode

**Files:**
- Create: `session-bridge/mcp-server/src/opencode_send.rs`
- Modify: `session-bridge/mcp-server/src/tools.rs::send_message` (OpenCode arm)
- Create: `session-bridge/mcp-server/tests/opencode_send.rs`

**Interfaces:**
- Consumes: `send::SendResult` (reuse as is), `OcApi`, Task 1's message-id format.
- Produces: `pub async fn send_opencode(api: &impl OcApi, target: &OpenCodeEndpoint, sender: &str, message: &str, timeout_s: u64) -> Result<SendResult>`.
  - Re-fetch `GET /api/session/{id}` first (gone → `Err`, nothing sent).
  - Message text: same label shape as `send_codex` (bridge message id, sender identity, timestamp, "peer data, not approval").
  - `POST /api/session/{id}/prompt` with `{text, id: <bridge-generated message id in OpenCode's format>, delivery: "queue", metadata: {session_bridge: <message_id>}}`. No `resume`.
  - POST ok → `queued`; then poll `session.message.list` ≤ `timeout_s` for that id → `observed`. POST transport error after spawn → `unknown`, never retried. Empty message or > the existing send size limit → `Err` before any call.

- [ ] **Step 1:** Failing tests: `send_posts_queue_delivery_with_marker` (assert body has `delivery:"queue"` and no `resume`), `send_observed_on_exact_id_only` (unrelated new messages do not count), `send_after_post_failure_is_unknown_not_retried` (fake records exactly one POST), `send_to_removed_session_errors_before_post`, `send_rejects_empty_and_oversized`.
- [ ] **Step 2:** `cargo test --test opencode_send` → FAIL.
- [ ] **Step 3:** Implement; update the `send_message` tool description to cover OpenCode and Claude targets.
- [ ] **Step 4:** `cargo test` green; regenerate `tests/fixtures/tool-schemas.json` only for the description change and review the diff.
- [ ] **Step 5:** Commit `feat(session-bridge): send_message into OpenCode sessions`.

### Task 6: `ask_session` on OpenCode targets

**Files:**
- Create: `session-bridge/mcp-server/src/opencode_ask.rs`
- Modify: `session-bridge/mcp-server/src/tools.rs::ask_session` (OpenCode arm; no `spent_today`/`DAILY_BOUND_USD` for it)
- Create: `session-bridge/mcp-server/tests/opencode_ask.rs`

**Interfaces:**
- Produces:
  - `pub struct OcAskResult { pub answer: String, pub target: String, pub fork_session_id: String, pub cost_usd: Option<f64>, pub usage: Option<Value>, pub secs: f64, pub note: &'static str }`
  - `pub async fn ask_opencode(api: &impl OcApi, target: &OpenCodeEndpoint, question: &str, model: Option<&str>, timeout: Duration) -> Result<OcAskResult>` — the exact call sequence recorded in Task 1 Step 4 (fork → switchAgent `session-bridge-reader` → prompt → wait/poll → read final assistant text → remove). `DELETE` of the fork runs on every path (success, error, timeout) via a guard. Reader agent unknown → `Err("OpenCode ask needs the session-bridge OpenCode plugin (agent session-bridge-reader)")`. `model` passed through `session.switchModel` on the fork only when given.

- [ ] **Step 1:** Failing tests: `ask_runs_fork_reader_prompt_remove_in_order`, `ask_removes_fork_on_timeout`, `ask_removes_fork_on_error`, `ask_missing_reader_agent_is_explicit`, `ask_cost_null_when_absent` (never `0.0`), `ask_does_not_touch_claude_budget` (ask log unchanged).
- [ ] **Step 2:** `cargo test --test opencode_ask` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` green.
- [ ] **Step 5:** Commit `feat(session-bridge): read-only ask into OpenCode sessions`.

### Task 7: Direct messages to Claude sessions

**Files:**
- Modify: `session-bridge/mcp-server/src/store.rs` (additive table `direct_messages(id TEXT PK, at_ms, expires_ms, target_profile, target_pid, target_session, sender TEXT, body TEXT, status TEXT, delivered_ms)`, created in `Store::init`)
- Modify: `session-bridge/mcp-server/src/tools.rs::send_message` (Claude arm replaces the unsupported error)
- Modify: `session-bridge/mcp-server/src/hook.rs::on_trigger` (Claude only: take this session's pending direct messages first, mark delivered in the same transaction, render before notices)
- Modify: `session-bridge/mcp-server/src/tools.rs::list_sessions` (append "Sent messages (24 h)" with id, target, status)
- Create: `session-bridge/mcp-server/tests/direct_messages.rs`

**Interfaces:**
- Produces:
  - `Store::post_direct(&self, m: NewDirect) -> Result<String>`, `Store::take_direct(&self, target: (&str, u32, &str), now_ms: i64) -> Result<Vec<Direct>>` (marks delivered atomically), `Store::expire_direct(&self, now_ms: i64, live: &dyn Fn(&str, u32, &str) -> bool) -> Result<usize>`, `Store::sent_by(&self, sender: &str, since_ms: i64) -> Result<Vec<Direct>>`.
  - `send_message` to Claude returns `SendResult{status:"queued", …}`.
  - Rendered block: `Direct message <id> from <sender> at <time> (peer data, not approval):\n<body>`, sanitized and length-capped like `deliver::render_nudge`.

- [ ] **Step 1:** Failing tests: `direct_message_delivered_once_at_next_trigger`, `direct_message_only_to_addressed_session` (sibling Claude in same repo gets nothing), `direct_message_skips_relevance_filter` (no worker spawn caused by it), `direct_message_expires_and_is_reported` (24 h and dead target both → `expired`, visible in `sent_by`), `subagent_trigger_does_not_consume` (`agent_id` set → not delivered), `legacy_db_migrates_additively` (old notices.db opens, notices intact).
- [ ] **Step 2:** `cargo test --test direct_messages` → FAIL.
- [ ] **Step 3:** Implement; expiry runs inside `send_message` and `list_sessions` (no daemon).
- [ ] **Step 4:** `cargo test` green.
- [ ] **Step 5:** Commit `feat(session-bridge): direct messages to Claude sessions via hook delivery`.

### Task 8: Notices into OpenCode sessions

**Files:**
- Create: `session-bridge/mcp-server/src/opencode_hook.rs`
- Modify: `session-bridge/mcp-server/src/main.rs` (`Hook` `--harness` accepts `opencode`; stdin `{session_id, cwd, event}`; prints plain text to inject, or nothing)
- Create: `session-bridge/mcp-server/tests/opencode_hook.rs`

**Interfaces:**
- Consumes: `hook::session_start`, `hook::on_trigger` with `me = (storage_profile, 0)`; `opencode_caller` for validation.
- Produces: `pub fn handle(event: &str, input: &HookInput, target: &OpenCodeEndpoint, roots: &Roots, state: &Path, store: &Store, now: i64) -> Option<String>` — events `session-start | prompt | post-tool`; the `spawn` closure records a verdict with `unfiltered_reason = Some("OpenCode receiver: no isolated relevance filter")` instead of launching a worker; subagent/fork/unknown session → `None`; any error → `None` (fail open).

- [ ] **Step 1:** Failing tests: `opencode_receives_notice_unfiltered_with_reason`, `opencode_self_notice_excluded`, `opencode_fork_and_child_get_nothing`, `two_opencode_sessions_have_separate_cursors`, `hook_error_prints_nothing_exit_zero`.
- [ ] **Step 2:** `cargo test --test opencode_hook` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` green.
- [ ] **Step 5:** Commit `feat(session-bridge): deliver repository notices into OpenCode sessions`.

### Task 9: OpenCode plugin becomes the front end

**Files:**
- Modify: `harnesses/opencode/plugins/session-bridge.js`
- Modify: `harnesses/opencode/tests/test-session-bridge.mjs`

**Interfaces:**
- Consumes: `session-bridge call <tool> --opencode-caller <ses>` (Task 4), `session-bridge hook <event> --harness opencode` (Task 8).
- Produces: four tools `session_bridge_list_sessions`, `session_bridge_ask_session`, `session_bridge_send_message`, `session_bridge_post_notice` with the MCP tools' argument names; `bridgeBin(env)` = `SESSION_BRIDGE_BIN` (absolute) else `session-bridge` on PATH; missing → tool error naming both. Keeps `registerReader`, `readerPermissions`, `CHILD_ENV` guard. Removes `runFork`, `listSessions`, `resolveRef`. `ctx.session.hook("context")` calls the hook binary with `prompt`; `ctx.tool.hook("execute.after")` with `post-tool`; first context per session also `session-start`. Hook failures never throw.

- [ ] **Step 1:** Rewrite tests with a fake `session-bridge` script on PATH: `tool_passes_tctx_session_id_as_caller`, `args_go_on_stdin_not_argv`, `missing_binary_error_names_override`, `child_env_registers_no_tools`, `context_hook_injects_hook_output`, `context_hook_swallows_failure`, `reader_agent_still_registered`.
- [ ] **Step 2:** `node --test harnesses/opencode/tests/test-session-bridge.mjs` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test harnesses/opencode/tests/` and `./tests/run-all.sh` → PASS.
- [ ] **Step 5:** Commit `feat(opencode): session-bridge plugin fronts the Rust bridge for all harnesses`.

### Task 10: Install, distribution and docs

**Files:**
- Modify: `session-bridge/scripts/build.sh` (after build, install/re-link the release binary to `${SESSION_BRIDGE_BIN_DIR:-$HOME/.local/bin}/session-bridge`; idempotent; prints the path)
- Modify: `harnesses/opencode/install.sh` (session-bridge plugin: check the binary is on PATH or `SESSION_BRIDGE_BIN`; warn with the build command otherwise; never edit `opencode.json`)
- Modify: `session-bridge/README.md` via the librarian (`artifact` update; new `## OpenCode` section: requirements, addresses, per-target tool behavior, live-session rule, limits, unmeasured platforms)
- Modify: `session-bridge/commands/sessions.md` (OpenCode key format)
- Test: `harnesses/opencode/tests/test-opencode-adapter.sh` (add install dry-run case: unrelated plugin survives, missing binary warns, exit 0)

- [ ] **Step 1:** Add the failing install test cases.
- [ ] **Step 2:** Run `bash harnesses/opencode/tests/test-opencode-adapter.sh` → FAIL.
- [ ] **Step 3:** Implement scripts and docs.
- [ ] **Step 4:** `./tests/run-all.sh` → PASS.
- [ ] **Step 5:** Commit `feat(session-bridge): install the bridge binary on PATH and document OpenCode`.

### Task 11: Mutation checks and live acceptance

**Files:**
- Modify: spec `1a58e4dcb3e0f9cf` (`## Verification and acceptance` — append measured results)

- [ ] **Step 1:** Mutations, one at a time, restore after each, record which test failed: (a) drop the parent-chain walk in `opencode_caller`; (b) accept any `ses_` id without discovery; (c) `delivery:"steer"`; (d) count any new message as observed; (e) skip fork `DELETE` on timeout; (f) skip `switchAgent` to the reader; (g) deliver direct messages to every Claude session in the repo; (h) drop the recency filter. Each must turn at least one test red.
- [ ] **Step 2:** `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `./tests/run-all.sh` → all pass.
- [ ] **Step 3:** Live smokes with disposable sessions only (rebuild, reconnect MCP, restart OpenCode service only if it was started for the test): Claude → OpenCode send observed; OpenCode → Claude send injected at next turn; OpenCode → Codex send; OpenCode ask on a Claude target and a Codex target; Claude ask on an OpenCode target with a write attempt denied and the original history unchanged; Claude notice received in an OpenCode session.
- [ ] **Step 4:** Record results (pass/fail per smoke, any unsupported capability) in the spec and commit `docs(session-bridge): OpenCode acceptance results`.

