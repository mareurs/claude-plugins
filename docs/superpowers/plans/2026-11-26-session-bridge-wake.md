# session-bridge wake watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An idle Claude Code session is woken by an addressed notice (`post_notice(to=...)`) when its profile opted in with a marker file.

**Architecture:** A new `session-bridge watch` subcommand runs as an `asyncRewake` hook (events `SessionStart` and `Stop`). It polls the notice store for notices addressed to its session without moving a cursor, then calls `direct::take` (which moves the cursor first), prints the text on stderr and exits 2. A claim in `EndpointState` keeps one watcher per endpoint; a guard limits wakes. All logic lives in a new module `src/wake.rs` with an injected clock and sleep, so tests run without waiting.

**Tech Stack:** Rust 2021, `rusqlite`, `clap`, `fs2` (existing `state::update` lock). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-26-session-bridge-wake-design.md`

## Global Constraints

- Opt-in is the file `<config-dir>/session-bridge-wake`, with `<config-dir>` = `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. No file, no wake. No new environment variable.
- Loop guard: at most one wake per 60 s and at most 10 per hour per endpoint. Over the limit the watcher exits 0 and takes nothing.
- Hook entries: `timeout: 7200`; watcher deadline 7000 s (`DEADLINE_MS = 7_000_000`).
- The watcher exits 0 when `pid_alive(roots, claude_pid)` is false (host gone).
- Fail-open: any error exits 0 with no output. Exit 2 is only a deliberate wake.
- Delivery stays at most once: `direct::take` moves the cursor before it returns text.
- Do not change a tool description or schema: `tests/fixtures/tool-schemas.json` pins them.
- Do not bump a version in a feature commit. After the last task run `./scripts/release.sh session-bridge` with `NO_PUSH=1` (CLAUDE.md § Version Management).
- Write every text of this repository in English.

## Review Focus

1. **Guard blocks, notice survives.** A notice posted while the guard blocks stays unconsumed and `on_trigger` still delivers it at the next prompt (Task 3).
2. **`/clear` while waiting.** A notice addressed to the id the session had before `/clear` still wakes it (Task 3).
3. **Two watchers.** `SessionStart` and `Stop` both arm one: exactly one waits (Task 2).
4. **Stale claim.** A watcher killed without cleanup leaves a claim; the next watcher takes over (Task 2).
5. **Host gone with a notice pending.** The watcher exits 0 without calling `take`, so the cursor does not move and no notice is lost (Task 3).

## File Structure

- Create `session-bridge/mcp-server/src/wake.rs`: marker check, guard, claim, `watch` loop. One responsibility: decide when an idle session is woken.
- Modify `src/state.rs`: four new `EndpointState` fields.
- Modify `src/lib.rs`: `pub mod wake;`.
- Modify `src/main.rs`: `Command::Watch` and the fail-open runner.
- Modify `src/server.rs`: `addressed_result` feedback line.
- Modify `hooks/run.sh`, `hooks/hooks.json`: route and arm the watcher.
- Create `tests/wake.rs`, `tests/watch_cli.rs`. Modify `tests/state.rs`, `tests/store.rs`.
- Modify `README.md`, `skills/coordinating-sessions/SKILL.md`, `commands/sessions.md`: text.

All paths are under `session-bridge/` unless they start with `docs/`. Run tests with `cargo test --test <name>` in `session-bridge/mcp-server`.

---

### Task 1: State fields, marker and guard

**Files:**
- Modify: `session-bridge/mcp-server/src/state.rs` (struct `EndpointState`, `Default`)
- Modify: `session-bridge/mcp-server/src/lib.rs`
- Create: `session-bridge/mcp-server/src/wake.rs`
- Test: `session-bridge/mcp-server/tests/wake.rs`, `session-bridge/mcp-server/tests/state.rs`

**Interfaces:**
- Produces, in `state.rs`, on `EndpointState` (all `#[serde(default)]`): `watcher_pid: Option<u32>`, `watcher_started_ms: i64` (the watcher's `process_start_ms`, 0 when none), `watch_until_ms: i64` (0 when none), `wake_ms: Vec<i64>` (times of recent wakes).
- Produces, in `wake.rs`:
  - `pub const POLL_MS: u64 = 2_000; DEADLINE_MS: i64 = 7_000_000; GUARD_MIN_INTERVAL_MS: i64 = 60_000; GUARD_MAX_PER_HOUR: usize = 10;`
  - `pub fn wake_enabled(env: &dyn Fn(&str) -> Option<String>) -> bool`
  - `pub fn guard_allows(wake_ms: &[i64], now_ms: i64) -> bool`

- [ ] **Step 1: Write the failing tests** in `tests/wake.rs`:
  - `marker_file_enables_wake`: temp dir as `CLAUDE_CONFIG_DIR`; `wake_enabled` is false, then true after `std::fs::write(dir.join("session-bridge-wake"), "")`.
  - `config_dir_falls_back_to_home_dot_claude`: env has only `HOME=<tmp>`; marker at `<tmp>/.claude/session-bridge-wake` gives true.
  - `guard_allows_first_wake_and_blocks_within_60s`: `guard_allows(&[], 1_000_000)` true; `guard_allows(&[1_000_000], 1_059_999)` false; `guard_allows(&[1_000_000], 1_060_000)` true.
  - `guard_blocks_the_eleventh_wake_in_an_hour`: ten wakes 61 s apart ending at `t`, `guard_allows(&wakes, t + 61_000)` false; true once the oldest is over 3 600 000 ms old.
  In `tests/state.rs` extend `update_creates_parents_and_round_trips_every_field` to set and assert the four new fields.
- [ ] **Step 2: Run to verify failure:** `cargo test --test wake --test state`. Expected: compile errors (`wake` module and fields missing).
- [ ] **Step 3: Implement** the four fields (defaults `None`, `0`, `0`, empty) and `wake.rs` with the signatures above. `wake_enabled` reads `CLAUDE_CONFIG_DIR`, else `HOME` + `/.claude`, and tests `Path::is_file`.
- [ ] **Step 4: Run to verify pass:** `cargo test --test wake --test state`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add` the six paths; message `feat(session-bridge): wake opt-in marker, loop guard and endpoint state fields`.

### Task 2: Single watcher per endpoint

**Files:**
- Modify: `session-bridge/mcp-server/src/wake.rs`
- Test: `session-bridge/mcp-server/tests/wake.rs`

**Interfaces:**
- Consumes: `state::{update, load_or_default, endpoint_path}`, `endpoints::{pid_alive, process_start_ms, Roots}`.
- Produces:
  - `pub fn claim_watcher(path: &Path, roots: &Roots, own_pid: u32, now_ms: i64) -> bool`: under `state::update`, true and records `watcher_pid`, `watcher_started_ms` (`process_start_ms(roots, own_pid)`, else 0) and `watch_until_ms = now_ms + DEADLINE_MS` when no live claim exists. A claim is live when `watcher_pid` is `Some(p)`, `pid_alive(roots, p)` and `process_start_ms(roots, p) == Some(watcher_started_ms)` (or `watcher_started_ms == 0`).
  - `pub fn release_watcher(path: &Path, own_pid: u32)`: clears the three fields only when `watcher_pid == Some(own_pid)`.

- [ ] **Step 1: Write the failing tests.** Use a fake `proc_root` (`proc/<pid>/stat` files as in `tests/endpoints.rs`) and a temp state path:
  - `second_claim_loses_while_the_first_is_alive` (Review Focus 3): `claim_watcher` for pid 100 true, for pid 200 false.
  - `claim_is_free_after_release`: release 100, claim 200 true; `release_watcher(path, 999)` leaves a claim of 200 in place.
  - `stale_claim_is_taken_over` (Review Focus 4): claim 100, remove `proc/100`, claim 200 true.
  - `recycled_pid_does_not_keep_a_claim`: claim 100 with start time 5, rewrite `proc/100/stat` with start time 9, claim 200 true.
- [ ] **Step 2: Run to verify failure:** `cargo test --test wake claim`. Expected: compile error, functions missing.
- [ ] **Step 3: Implement** both functions. Capture the result of the closure in a local `bool` (the closure of `update` returns nothing). On an `update` error return false.
- [ ] **Step 4: Run to verify pass:** `cargo test --test wake`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(session-bridge): one wake watcher per endpoint`.

### Task 3: The watch loop

**Files:**
- Modify: `session-bridge/mcp-server/src/wake.rs`
- Test: `session-bridge/mcp-server/tests/wake.rs`

**Interfaces:**
- Consumes: Tasks 1 and 2; `direct::take`, `store::Store::direct_after`, `cursor::get_direct`, `hook::HookInput`, `paths::is_safe_component`, `state::{update, load_or_default}`.
- Produces:
  ```rust
  pub enum WatchOutcome { Wake(String), Done }
  pub struct Clock<'a> { pub now_ms: &'a dyn Fn() -> i64, pub sleep_ms: &'a dyn Fn(u64) }
  pub fn watch(input: &HookInput, me: (&str, u32), roots: &Roots, state: &Path,
               store: &Store, clock: &Clock) -> WatchOutcome
  ```
  `me.1` is the Claude pid. The function polls every `POLL_MS`, never sleeps itself (it calls `clock.sleep_ms`), and releases its claim before it returns.

- [ ] **Step 1: Write the failing tests** with a fake clock whose `sleep_ms` advances a `Cell<i64>` and a fake `proc` that holds the Claude pid. Reuse the `Fx` helper pattern of `tests/direct.rs` (store, state, roots, `post_to`). Each test arms `watch` with `HookInput { session_id: "s1".into(), ..Default::default() }`:
  - `a_notice_for_the_session_wakes_once`: post to `s1` before the call; outcome is `Wake(text)` with the title in `text`; a second `watch` call returns `Done` after the deadline with no new notice (at most once).
  - `a_notice_for_another_id_does_not_wake`: post to `s2`; `watch` returns `Done` at the deadline (clock advanced past `DEADLINE_MS`).
  - `a_notice_posted_while_waiting_wakes`: `sleep_ms` posts the notice on its third call; outcome `Wake`.
  - `the_old_id_after_clear_still_wakes` (Review Focus 2): write endpoint state with `session_id = "old"` before the call, post to `old`; outcome `Wake`.
  - `host_gone_exits_without_taking` (Review Focus 5): remove `proc/<pid>` inside `sleep_ms` after the notice exists; outcome `Done`; `get_direct(&state, profile, "s1")` is still 0.
  - `the_guard_blocks_and_the_notice_survives` (Review Focus 1): preset `wake_ms = [now - 1_000]` in endpoint state; post a notice; outcome `Done`; `get_direct` still 0; then `take(&["s1"], ...)` (what `on_trigger` calls) still returns the text.
  - `a_wake_is_recorded_for_the_guard`: after a `Wake`, `load_or_default(path).wake_ms` holds the wake time.
  - `a_subagent_never_arms`: `agent_id: Some("a".into())` returns `Done` and leaves `watcher_pid` as `None`.
  - `release_happens_before_returning`: after `Wake` and after `Done`, `watcher_pid` is `None`.
- [ ] **Step 2: Run to verify failure:** `cargo test --test wake watch`. Expected: compile error, `watch` missing.
- [ ] **Step 3: Implement `watch`.** Order per loop pass: host check (`pid_alive`), deadline check, build `ids` (input id when non-empty, then `st.session_id` from endpoint state when different, same as `on_trigger`), peek with `store.direct_after(id, get_direct(state, me.0, id), 1)` for every safe id, and when any is pending: `guard_allows` else return `Done`; then `take_direct(&ids, ...)`; on `Some(text)` record the wake in `wake_ms` (drop entries older than one hour) and return `Wake(text)`. Claim before the first pass with `claim_watcher`; call `release_watcher` on every return path.
- [ ] **Step 4: Run to verify pass:** `cargo test --test wake`. Expected: PASS, all tests.
- [ ] **Step 5: Commit:** `feat(session-bridge): watch loop that wakes on an addressed notice`.

### Task 4: CLI and hook wiring

**Files:**
- Modify: `session-bridge/mcp-server/src/main.rs` (`Command`, `main`, `run`)
- Modify: `session-bridge/hooks/run.sh`, `session-bridge/hooks/hooks.json`
- Test: `session-bridge/mcp-server/tests/watch_cli.rs`

**Interfaces:**
- Consumes: `wake::{watch, wake_enabled, WatchOutcome, Clock}`, `endpoints::claude_pid_of`, `paths::{profile_of, state_root}`.
- Produces: `session-bridge watch` (reads the hook JSON on stdin; on `Wake(text)` writes `text` and a newline to stderr and exits 2; otherwise exits 0 with no output).

- [ ] **Step 1: Write the failing tests** in `tests/watch_cli.rs`, spawning `env!("CARGO_BIN_EXE_session-bridge")` as `tests/hook_cli.rs` does, with a temp `XDG_STATE_HOME` and `CLAUDE_CONFIG_DIR`:
  - `watch_without_the_marker_exits_0_silently`: no marker file, stdin `{"session_id":"s1","cwd":"/tmp"}`; exit code 0, empty stdout and stderr, and no `notices.db` created.
  - `watch_without_a_claude_ancestor_exits_0_silently`: marker present; the test process has no Claude ancestor, so `claude_pid_of` is `None`; exit code 0, empty output.
  - `watch_survives_garbage_stdin`: stdin `not json`; exit code 0.
- [ ] **Step 2: Run to verify failure:** `cargo test --test watch_cli`. Expected: FAIL (unknown subcommand, exit 2 from clap).
- [ ] **Step 3: Implement.** Add `Command::Watch` (no arguments, doc comment "Wait for an addressed notice and wake an idle Claude session (asyncRewake hook).") and a `run_watch_fail_open() -> !` called from `main` when `args[1] == "watch"`, with the same silent panic hook as `run_hook_fail_open`. In `run`, the `Watch` arm is `Ok(())`. `run.sh`: `case "$1" in watch) exec "$bin" watch ;; *) exec "$bin" hook "$1" ;; esac`. `hooks.json`: add to `SessionStart` a second group and add a `Stop` group, each `{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh watch", "asyncRewake": true, "timeout": 7200 }`. The `watch` argument is the same for both events.
- [ ] **Step 4: Run to verify pass:** `cargo test --test watch_cli --test hook_cli`. Expected: PASS. Also `cargo clippy -- -D warnings`.
- [ ] **Step 5: Commit:** `feat(session-bridge): watch subcommand and asyncRewake hooks`.

### Task 5: Sender feedback

**Files:**
- Modify: `session-bridge/mcp-server/src/server.rs` (`addressed_result`)
- Test: `session-bridge/mcp-server/tests/store.rs`

**Interfaces:**
- Consumes: `EndpointState.watch_until_ms` (Task 1; set by `claim_watcher`, cleared by `release_watcher`).
- Produces: `addressed_result` keeps its signature. When `target.watch_until_ms > now_ms` the text says `an idle session is woken` and keeps the age sentence; otherwise the text is unchanged.

- [ ] **Step 1: Write the failing tests** next to `addressed_result_reports_the_age_of_the_last_look`:
  - `addressed_result_says_an_idle_session_is_woken_when_a_watcher_is_armed`: state with `session_id: "S"`, `watch_until_ms: now + 1`; text contains `idle session is woken`.
  - `addressed_result_is_unchanged_without_a_watcher`: `watch_until_ms: 0`; text does not contain `woken` and still contains `next prompt or tool call`.
  - `addressed_result_ignores_an_expired_watch`: `watch_until_ms: now - 1`; no `woken`.
- [ ] **Step 2: Run to verify failure:** `cargo test --test store addressed_result`. Expected: the first new test FAILS.
- [ ] **Step 3: Implement** the branch. The first sentence keeps `queued`; never write `delivered`.
- [ ] **Step 4: Run to verify pass:** `cargo test --test store --test server`. Expected: PASS (the pinned tool schemas are unchanged).
- [ ] **Step 5: Commit:** `feat(session-bridge): post_notice reports an armed wake watcher`.

### Task 6: Text, build and acceptance in the TUI

**Files:**
- Modify: `session-bridge/README.md` (§ Addressed notices, the line "An idle session does not wake up", and the Environment section: add a short "Settings" paragraph naming the marker file)
- Modify: `session-bridge/skills/coordinating-sessions/SKILL.md` (the line "An idle session does not wake up", about line 101)
- Modify: `session-bridge/commands/sessions.md` (the `post_notice` sentence)

- [ ] **Step 1: Edit the three texts.** State the current situation only: an addressed notice wakes an idle Claude Code session when the receiver's profile has `<config-dir>/session-bridge-wake`; at most one wake per minute and ten per hour; otherwise it shows at the next prompt or tool call. No history words.
- [ ] **Step 2: Run the full suite:** `cargo test` and `cargo clippy -- -D warnings` in `session-bridge/mcp-server`; `./tests/run-all.sh` at the repository root. Expected: all pass.
- [ ] **Step 3: Build and install the binary:** `session-bridge/scripts/build.sh`. Expected: `~/.cargo/bin/session-bridge watch </dev/null; echo $?` prints `0`.
- [ ] **Step 4: Acceptance in the interactive TUI (manual, `tmux`).** Receiver: `touch ~/.claude-kat/session-bridge-wake`; start `claude` in a scratch directory in `tmux`; do not type a prompt. Sender: from another session `post_notice(title, body, to=<receiver key>)`. Expected: the sender result contains `an idle session is woken`; within 2 s plus the poll the receiver shows `Stop hook feedback` with the notice text and the model answers. Then post twice within 60 s: the second shows at the next prompt, not as a wake. Then `kill -9` the receiver's `claude`: `pgrep -f "session-bridge watch"` shows no leftover within 5 s. Record the result in a short note under the spec's Measurement section.
- [ ] **Step 5: Commit** the text and the acceptance note: `docs(session-bridge): idle Claude sessions are woken by addressed notices`. Then `NO_PUSH=1 ./scripts/release.sh session-bridge patch` and cold-restart the Claude Code instances (CLAUDE.md § Version Management).

---

## Self-review

- **Spec coverage:** arm on `SessionStart` and `Stop` (Task 4); singleton (2); peek, `take`, exit 2 (3); host-liveness (3); marker opt-in (1, 4); sender feedback (5); loop guard (1, 3); deadline 7000 s under timeout 7200 (1, 4). The spec's `messagingSocketPath` question stays open and is not built.
- **Not automated:** the end-to-end wake needs a live Claude Code host. Task 6 step 4 is the proof, and the spec's gates G1 to G3 already measured the host side.
- **Types:** `watch`, `claim_watcher`, `release_watcher`, `guard_allows`, `wake_enabled` and the four `EndpointState` fields have one spelling across tasks.
- **Open value:** `POLL_MS = 2_000` is the plan's choice for the spec's "seconds, not milliseconds". Change it in one constant.
