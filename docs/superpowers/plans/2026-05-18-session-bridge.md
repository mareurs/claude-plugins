# session-bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CC plugin (`session-bridge`) that registers each running Claude Code session in `~/.claude/sessions/active.json` and exposes a Rust MCP server with `list_sessions`, `ask_session`, `set_alias` tools so other local sessions can query a session in its loaded context via fork-resume.

**Architecture:** Bash SessionStart/Stop hooks maintain the registry under `flock`. Rust MCP server (rmcp crate, stdio) reads the registry and spawns `claude -p --resume …` to answer `ask_session`. Two answer modes: ephemeral (copy transcript → fork → discard) and bidirectional (resume in-place, mutates producer history). Stateless — no daemon.

**Tech Stack:** bash + jq + flock for hooks. Rust + rmcp + tokio + serde + nix for MCP server. `claude` CLI as the inference subprocess. Tests: bash via repo's `tests/lib/fixtures.sh`, Rust via `cargo test`.

**Spec:** `docs/superpowers/specs/2026-05-18-session-bridge-mcp-design.md`

---

## File structure

Files created by this plan (all under `session-bridge/` unless noted):

| Path | Responsibility |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest + `mcpServers` entry |
| `hooks/hooks.json` | Hook event bindings |
| `hooks/lib.sh` | Registry path, flock helper, jq idioms |
| `hooks/register.sh` | SessionStart: write registry entry |
| `hooks/unregister.sh` | Stop: remove registry entry |
| `mcp-server/Cargo.toml` | Rust crate manifest |
| `mcp-server/src/main.rs` | rmcp stdio bootstrap |
| `mcp-server/src/registry.rs` | Load / prune / resolve_ref / set_alias |
| `mcp-server/src/claude_cli.rs` | Build argv, spawn, timeout, cleanup |
| `mcp-server/src/tools.rs` | MCP tool handlers |
| `mcp-server/src/error.rs` | Typed errors → MCP responses |
| `mcp-server/tests/registry.rs` | Registry unit tests |
| `mcp-server/tests/claude_cli.rs` | Subprocess integration tests via mock binary |
| `scripts/build.sh` | `cargo test` + `cargo build --release` |
| `commands/sessions.md` | `/sessions` slash command |
| `tests/test-register.sh` | Hook test: register adds entry |
| `tests/test-unregister.sh` | Hook test: unregister removes entry |
| `tests/test-concurrent-register.sh` | Hook test: parallel flock |
| `tests/lib/session-bridge-fixtures.sh` | Test helpers for registry assertions |
| `README.md` | Install + usage + dev |
| Modify `tests/run-all.sh` (repo root) | Wire new bash tests |

---

## Task 1: Plugin skeleton

**Files:**
- Create: `session-bridge/.claude-plugin/plugin.json`
- Create: `session-bridge/hooks/hooks.json`
- Create: `session-bridge/README.md` (stub)

- [ ] **Step 1: Create plugin manifest**

```bash
mkdir -p session-bridge/.claude-plugin session-bridge/hooks
```

Write `session-bridge/.claude-plugin/plugin.json`:

```json
{
  "name": "session-bridge",
  "description": "Cross-session MCP bridge — ask one Claude Code session a question from another, in its loaded context.",
  "version": "0.1.0",
  "author": { "name": "Marius" },
  "license": "MIT",
  "keywords": ["mcp", "session", "rpc", "bridge"]
}
```

The `mcpServers` block is added in Task 16 once the binary path is known to build.

- [ ] **Step 2: Create hooks.json**

Write `session-bridge/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/register.sh" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/unregister.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Create README stub**

Write `session-bridge/README.md`:

```markdown
# session-bridge

Cross-session MCP bridge for Claude Code. Register every active session locally; ask one session a question from another, answered in its own loaded context.

Status: in development. See `docs/superpowers/specs/2026-05-18-session-bridge-mcp-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add session-bridge/
git commit -m "feat(session-bridge): plugin skeleton"
```

---

## Task 2: Hook library (`lib.sh`)

**Files:**
- Create: `session-bridge/hooks/lib.sh`

- [ ] **Step 1: Write the library**

Write `session-bridge/hooks/lib.sh`:

```bash
#!/usr/bin/env bash
# session-bridge/hooks/lib.sh — shared helpers for register/unregister hooks.
# Source this file from each hook.

# Registry layout (mirrored from mcp-server/src/registry.rs):
#   ~/.claude/sessions/active.json — JSON: {"version":1,"sessions":{<id>:{...}}}
#   ~/.claude/sessions/.lock       — flock target (separate file to avoid self-deadlock)
SB_DIR="${HOME}/.claude/sessions"
SB_REGISTRY="${SB_DIR}/active.json"
SB_LOCK="${SB_DIR}/.lock"
SB_FLOCK_TIMEOUT="${SB_FLOCK_TIMEOUT:-10}"

sb_ensure_dir() {
  mkdir -p "$SB_DIR"
  chmod 700 "$SB_DIR" 2>/dev/null || true
  [ -f "$SB_REGISTRY" ] || printf '%s\n' '{"version":1,"sessions":{}}' > "$SB_REGISTRY"
  [ -f "$SB_LOCK" ] || : > "$SB_LOCK"
}

# Run a jq filter under exclusive flock with atomic rename.
# Usage: sb_mutate_registry '<jq filter>' [jq-arg-name jq-arg-value]...
sb_mutate_registry() {
  local filter="$1"; shift
  sb_ensure_dir
  (
    if ! flock -w "$SB_FLOCK_TIMEOUT" 9; then
      echo "session-bridge: flock timeout on $SB_LOCK" >&2
      exit 0
    fi
    local tmp
    tmp="$(mktemp "${SB_REGISTRY}.XXXXXX")"
    if jq "$@" "$filter" "$SB_REGISTRY" > "$tmp"; then
      mv "$tmp" "$SB_REGISTRY"
    else
      rm -f "$tmp"
      echo "session-bridge: jq filter failed" >&2
    fi
  ) 9>"$SB_LOCK"
}

# Derive the CC instance name (main / sdd / kat / ...) from CLAUDE_CONFIG_DIR or transcript path.
sb_instance() {
  local transcript="$1"
  if [ -n "$CLAUDE_CONFIG_DIR" ]; then
    basename "$CLAUDE_CONFIG_DIR" | sed -E 's/^\.claude-?//; s/^\.claude$/main/; s/^$/main/'
    return
  fi
  case "$transcript" in
    "$HOME/.claude/"*)     echo main ;;
    "$HOME/.claude-sdd/"*) echo sdd ;;
    "$HOME/.claude-kat/"*) echo kat ;;
    *) echo unknown ;;
  esac
}
```

- [ ] **Step 2: Sanity-run library sourcing**

Run:

```bash
bash -n session-bridge/hooks/lib.sh && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add session-bridge/hooks/lib.sh
git commit -m "feat(session-bridge): hook library with flock + jq mutate helper"
```

---

## Task 3: Test fixtures for registry

**Files:**
- Create: `tests/lib/session-bridge-fixtures.sh`

- [ ] **Step 1: Write fixtures**

Write `tests/lib/session-bridge-fixtures.sh`:

```bash
#!/usr/bin/env bash
# tests/lib/session-bridge-fixtures.sh — helpers for session-bridge hook tests.
# Sourced after tests/lib/fixtures.sh (uses pass/fail/print_summary from there).

SB_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../session-bridge/hooks" && pwd)"

# Run a hook with an isolated $HOME so the real registry is untouched.
# Args: <hook-script> <stdin-json>
# Sets: SB_TEST_HOME, SB_TEST_REGISTRY
sb_run_hook() {
  local hook="$1"
  local payload="$2"
  SB_TEST_HOME="$(mktemp -d)"
  SB_TEST_REGISTRY="$SB_TEST_HOME/.claude/sessions/active.json"
  HOME="$SB_TEST_HOME" CLAUDE_CONFIG_DIR="" \
    bash "$SB_HOOK_DIR/$hook" <<< "$payload"
}

sb_registry_has_session() {
  local id="$1"
  jq -e --arg id "$id" '.sessions[$id] != null' "$SB_TEST_REGISTRY" >/dev/null 2>&1
}

sb_registry_field() {
  local id="$1" field="$2"
  jq -r --arg id "$id" --arg f "$field" '.sessions[$id][$f] // empty' "$SB_TEST_REGISTRY"
}

sb_session_count() {
  jq -r '.sessions | length' "$SB_TEST_REGISTRY"
}

sb_cleanup() {
  [ -n "$SB_TEST_HOME" ] && rm -rf "$SB_TEST_HOME"
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/lib/session-bridge-fixtures.sh
git commit -m "test(session-bridge): registry test fixtures"
```

---

## Task 4: `register.sh` — write entry on SessionStart

**Files:**
- Create: `session-bridge/hooks/register.sh`
- Test: `tests/test-register.sh`

- [ ] **Step 1: Write the failing test**

Write `tests/test-register.sh`:

```bash
#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/fixtures.sh
source "$SCRIPT_DIR/lib/fixtures.sh"
# shellcheck source=lib/session-bridge-fixtures.sh
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== register.sh =="

# Test 1: a simple SessionStart payload creates a registry entry.
payload='{"session_id":"abc-123","cwd":"/tmp/work","transcript_path":"/home/u/.claude/projects/x/abc-123.jsonl","hook_event_name":"SessionStart"}'
sb_run_hook register.sh "$payload" >/dev/null

if sb_registry_has_session "abc-123"; then
  pass "registers session by id"
else
  fail "registers session by id" "no entry written"
fi

# Test 2: fields are populated.
[ "$(sb_registry_field abc-123 cwd)" = "/tmp/work" ] && pass "cwd recorded" || fail "cwd recorded"
[ "$(sb_registry_field abc-123 transcript_path)" = "/home/u/.claude/projects/x/abc-123.jsonl" ] \
  && pass "transcript_path recorded" || fail "transcript_path recorded"
[ -n "$(sb_registry_field abc-123 pid)" ] && pass "pid recorded" || fail "pid recorded"
[ -n "$(sb_registry_field abc-123 started_at)" ] && pass "started_at recorded" || fail "started_at recorded"
[ "$(sb_registry_field abc-123 instance)" = "main" ] && pass "instance=main" || fail "instance=main"

# Test 3: re-registering same id is idempotent (no duplicates).
sb_run_hook register.sh "$payload" >/dev/null
[ "$(sb_session_count)" = "1" ] && pass "idempotent re-register" || fail "idempotent re-register"

sb_cleanup
print_summary "register.sh"
```

```bash
chmod +x tests/test-register.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bash tests/test-register.sh
```

Expected: fails with `session-bridge/hooks/register.sh: No such file or directory`.

- [ ] **Step 3: Write the hook**

Write `session-bridge/hooks/register.sh`:

```bash
#!/usr/bin/env bash
# session-bridge/hooks/register.sh — SessionStart hook.
# Stdin: JSON with session_id, cwd, transcript_path, hook_event_name.
# Always exits 0 (must never block CC startup).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

payload="$(cat)"
session_id="$(jq -r '.session_id // empty' <<< "$payload")"
cwd="$(jq -r '.cwd // empty' <<< "$payload")"
transcript_path="$(jq -r '.transcript_path // empty' <<< "$payload")"

if [ -z "$session_id" ]; then
  echo "session-bridge: no session_id in payload, skipping" >&2
  exit 0
fi

branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
instance="$(sb_instance "$transcript_path")"
pid="${PPID:-$$}"
started_at="$(date +%s)"

sb_mutate_registry \
  --arg id "$session_id" \
  --arg cwd "$cwd" \
  --arg tp "$transcript_path" \
  --arg branch "$branch" \
  --arg instance "$instance" \
  --argjson pid "$pid" \
  --argjson ts "$started_at" \
  '.sessions[$id] = {
     session_id: $id,
     transcript_path: $tp,
     cwd: $cwd,
     branch: $branch,
     pid: $pid,
     started_at: $ts,
     alias: (.sessions[$id].alias // null),
     instance: $instance
   }'

exit 0
```

```bash
chmod +x session-bridge/hooks/register.sh
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bash tests/test-register.sh
```

Expected: `register.sh: 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/hooks/register.sh tests/test-register.sh
git commit -m "feat(session-bridge): register.sh SessionStart hook + tests"
```

---

## Task 5: `unregister.sh` — remove entry on Stop

**Files:**
- Create: `session-bridge/hooks/unregister.sh`
- Test: `tests/test-unregister.sh`

- [ ] **Step 1: Write the failing test**

Write `tests/test-unregister.sh`:

```bash
#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/fixtures.sh"
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== unregister.sh =="

# Register first, then unregister.
reg='{"session_id":"id-1","cwd":"/tmp/a","transcript_path":"/home/u/.claude/projects/x/id-1.jsonl","hook_event_name":"SessionStart"}'
sb_run_hook register.sh "$reg" >/dev/null
sb_registry_has_session "id-1" || { fail "precondition: registered"; print_summary "unregister.sh"; exit 1; }

stop='{"session_id":"id-1","hook_event_name":"Stop","stop_hook_active":false}'
HOME="$SB_TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$stop" >/dev/null

sb_registry_has_session "id-1" && fail "removes entry by id" || pass "removes entry by id"
[ "$(sb_session_count)" = "0" ] && pass "session count is 0" || fail "session count is 0"

# Unregistering an unknown id is a no-op (exit 0, no error).
unknown='{"session_id":"does-not-exist","hook_event_name":"Stop"}'
HOME="$SB_TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$unknown"; rc=$?
[ "$rc" = "0" ] && pass "unknown id exits 0" || fail "unknown id exits 0"

sb_cleanup
print_summary "unregister.sh"
```

```bash
chmod +x tests/test-unregister.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bash tests/test-unregister.sh
```

Expected: fails — `unregister.sh: No such file or directory`.

- [ ] **Step 3: Write the hook**

Write `session-bridge/hooks/unregister.sh`:

```bash
#!/usr/bin/env bash
# session-bridge/hooks/unregister.sh — Stop hook. Always exits 0.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

payload="$(cat)"
session_id="$(jq -r '.session_id // empty' <<< "$payload")"
[ -z "$session_id" ] && exit 0

sb_mutate_registry --arg id "$session_id" 'del(.sessions[$id])'
exit 0
```

```bash
chmod +x session-bridge/hooks/unregister.sh
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bash tests/test-unregister.sh
```

Expected: `unregister.sh: 3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/hooks/unregister.sh tests/test-unregister.sh
git commit -m "feat(session-bridge): unregister.sh Stop hook + tests"
```

---

## Task 6: Concurrent flock test

**Files:**
- Test: `tests/test-concurrent-register.sh`

- [ ] **Step 1: Write the test**

Write `tests/test-concurrent-register.sh`:

```bash
#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/fixtures.sh"
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== concurrent register =="

SB_TEST_HOME="$(mktemp -d)"
SB_TEST_REGISTRY="$SB_TEST_HOME/.claude/sessions/active.json"

# Fire 20 register.sh in parallel with distinct session ids.
for i in $(seq 1 20); do
  payload=$(jq -nc --arg i "$i" \
    '{session_id:("p-"+$i),cwd:"/tmp",transcript_path:("/home/u/.claude/projects/x/p-"+$i+".jsonl"),hook_event_name:"SessionStart"}')
  HOME="$SB_TEST_HOME" CLAUDE_CONFIG_DIR="" \
    bash "$SB_HOOK_DIR/register.sh" <<< "$payload" &
done
wait

count="$(sb_session_count)"
[ "$count" = "20" ] && pass "20 parallel registers all land" || fail "20 parallel registers" "got $count"

# Registry is still valid JSON (no torn writes).
jq -e . "$SB_TEST_REGISTRY" >/dev/null 2>&1 && pass "registry is valid JSON" || fail "registry is valid JSON"

rm -rf "$SB_TEST_HOME"
print_summary "concurrent register"
```

```bash
chmod +x tests/test-concurrent-register.sh
```

- [ ] **Step 2: Run the test**

Run:

```bash
bash tests/test-concurrent-register.sh
```

Expected: `concurrent register: 2 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add tests/test-concurrent-register.sh
git commit -m "test(session-bridge): concurrent register flock safety"
```

---

## Task 7: Wire bash tests into `tests/run-all.sh`

**Files:**
- Modify: `tests/run-all.sh`

- [ ] **Step 1: Inspect current runner**

Run:

```bash
cat tests/run-all.sh
```

Note the existing pattern for adding a test (likely a list of `bash tests/<name>.sh` calls and exit-code aggregation).

- [ ] **Step 2: Add the three new tests**

Append session-bridge tests to the runner using the same pattern observed in Step 1. Each of the three (`test-register.sh`, `test-unregister.sh`, `test-concurrent-register.sh`) must be invoked and its exit code aggregated.

If the runner uses a `TESTS=(...)` array, add the three filenames. If it `bash tests/foo.sh` line-by-line and `|| FAIL=1`, add three matching lines in the same order.

- [ ] **Step 3: Run the full suite**

Run:

```bash
./tests/run-all.sh
```

Expected: existing tests still pass; new tests appear in output as `register.sh: 6 passed`, `unregister.sh: 3 passed`, `concurrent register: 2 passed`; overall exit code 0.

- [ ] **Step 4: Commit**

```bash
git add tests/run-all.sh
git commit -m "test(session-bridge): wire bash tests into run-all.sh"
```

---

## Task 8: Probe `claude` CLI flags (resolves spec open question 1)

**Files:**
- Create: `session-bridge/docs/claude-cli-probe.md`

- [ ] **Step 1: Capture help output**

Run:

```bash
mkdir -p session-bridge/docs
claude --help > session-bridge/docs/claude-cli-probe.md 2>&1 || true
printf '\n\n--- `claude -p --help` ---\n\n' >> session-bridge/docs/claude-cli-probe.md
claude -p --help >> session-bridge/docs/claude-cli-probe.md 2>&1 || true
```

- [ ] **Step 2: Resolve the four flag questions and append decisions**

Read the captured help. For each of these, decide and write the resolution at the top of the file as a fenced block:

```
RESOLVED FLAGS (used by mcp-server/src/claude_cli.rs):
  resume_flag           = "--resume"      # or "--continue" / "--session"
  resume_accepts_path   = true | false    # if false, ephemeral mode must use --session-id with a copied jsonl placed at the canonical path
  allowed_tools_flag    = "--allowed-tools <csv>"  # or empty if unsupported in -p mode
  max_turns_flag        = "--max-turns 1" # or empty if unsupported
  cwd_strategy          = "--cwd <path>" | "env PWD + chdir"
  prompt_passing        = "positional"    # or "stdin" / "--prompt"
```

If `claude --help` is unavailable in this environment, mark each value `unknown` and add a TODO at the top of `claude_cli.rs` for the implementer to fill in before Task 12 runs.

- [ ] **Step 3: Commit**

```bash
git add session-bridge/docs/claude-cli-probe.md
git commit -m "docs(session-bridge): probe claude CLI flag surface"
```

---

## Task 9: Rust crate skeleton

**Files:**
- Create: `session-bridge/mcp-server/Cargo.toml`
- Create: `session-bridge/mcp-server/src/main.rs`
- Create: `session-bridge/mcp-server/src/error.rs`
- Create: `session-bridge/scripts/build.sh`

- [ ] **Step 1: Write `Cargo.toml`**

```bash
mkdir -p session-bridge/mcp-server/src session-bridge/mcp-server/tests session-bridge/scripts
```

Write `session-bridge/mcp-server/Cargo.toml`:

```toml
[package]
name = "session-bridge-mcp"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "session-bridge-mcp"
path = "src/main.rs"

[dependencies]
rmcp = { version = "0.1", features = ["server", "transport-io"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "process", "fs", "io-util", "sync", "time"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "1"
nix = { version = "0.27", features = ["signal"] }
fs2 = "0.4"
tempfile = "3"

[dev-dependencies]
assert_cmd = "2"
predicates = "3"
```

> If the available `rmcp` API differs, adjust the feature flags during Task 16; the rest of the crate does not depend on rmcp internals.

- [ ] **Step 2: Write `error.rs`**

Write `session-bridge/mcp-server/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("no sessions registered")]
    NoSessionsRegistered,
    #[error("session not found for ref {0:?}; current: {1:?}")]
    SessionNotFound(String, Vec<String>),
    #[error("ambiguous ref {0:?}; matches: {1:?}")]
    AmbiguousRef(String, Vec<String>),
    #[error("session {0} pid {1} is dead")]
    SessionDied(String, i32),
    #[error("claude CLI not found on PATH")]
    ClaudeCliMissing,
    #[error("subprocess timed out after {0}s")]
    Timeout(u64),
    #[error("session {0} busy: bidirectional lock held")]
    SessionBusy(String),
    #[error("fork copy failed: {0}")]
    ForkFailed(String),
    #[error("registry corrupt: {0}")]
    RegistryCorrupt(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, BridgeError>;
```

- [ ] **Step 3: Write `main.rs` stub**

Write `session-bridge/mcp-server/src/main.rs`:

```rust
//! session-bridge MCP server — stdio transport. Bootstrap added in Task 16.
mod error;
mod registry;
mod claude_cli;
mod tools;

fn main() -> anyhow::Result<()> {
    // Real bootstrap wired in Task 16 once tool surface compiles.
    Ok(())
}
```

- [ ] **Step 4: Write `build.sh`**

Write `session-bridge/scripts/build.sh`:

```bash
#!/usr/bin/env bash
# session-bridge/scripts/build.sh — test + release build.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mcp-server"
cargo test --quiet
cargo build --release --quiet
echo "binary: $ROOT/mcp-server/target/release/session-bridge-mcp"
```

```bash
chmod +x session-bridge/scripts/build.sh
```

- [ ] **Step 5: Add stub modules so the crate compiles**

Write `session-bridge/mcp-server/src/registry.rs`:

```rust
//! Registry — load, prune, resolve_ref, set_alias. Implemented in Tasks 10–13.
```

Write `session-bridge/mcp-server/src/claude_cli.rs`:

```rust
//! Claude CLI subprocess — argv, spawn, timeout, cleanup. Implemented in Task 14.
```

Write `session-bridge/mcp-server/src/tools.rs`:

```rust
//! MCP tool handlers. Implemented in Task 15.
```

- [ ] **Step 6: Verify the crate compiles**

Run:

```bash
cd session-bridge/mcp-server && cargo build --quiet && cd -
```

Expected: builds cleanly (warnings about unused modules are OK).

- [ ] **Step 7: Commit**

```bash
git add session-bridge/mcp-server session-bridge/scripts
git commit -m "feat(session-bridge): Rust crate skeleton"
```

---

## Task 10: `registry.rs` — types and load

**Files:**
- Modify: `session-bridge/mcp-server/src/registry.rs`
- Test: `session-bridge/mcp-server/tests/registry.rs`

- [ ] **Step 1: Write the failing test**

Write `session-bridge/mcp-server/tests/registry.rs`:

```rust
use session_bridge_mcp::registry::{Registry, SessionEntry};

#[test]
fn loads_minimal_registry_from_json() {
    let json = r#"{
      "version": 1,
      "sessions": {
        "id-a": {
          "session_id": "id-a",
          "transcript_path": "/tmp/a.jsonl",
          "cwd": "/tmp/a",
          "branch": "main",
          "pid": 1,
          "started_at": 1000,
          "alias": null,
          "instance": "main"
        }
      }
    }"#;
    let reg: Registry = serde_json::from_str(json).unwrap();
    assert_eq!(reg.version, 1);
    assert_eq!(reg.sessions.len(), 1);
    let e: &SessionEntry = reg.sessions.get("id-a").unwrap();
    assert_eq!(e.session_id, "id-a");
    assert_eq!(e.cwd, "/tmp/a");
    assert_eq!(e.pid, 1);
    assert_eq!(e.alias, None);
}

#[test]
fn empty_registry_round_trips() {
    let reg = Registry::default();
    let s = serde_json::to_string(&reg).unwrap();
    let back: Registry = serde_json::from_str(&s).unwrap();
    assert_eq!(back.version, 1);
    assert!(back.sessions.is_empty());
}
```

Expose the crate as a library too so tests can import. Add to `Cargo.toml` (in `[package]` section already there):

```toml
[lib]
name = "session_bridge_mcp"
path = "src/lib.rs"
```

Create `session-bridge/mcp-server/src/lib.rs`:

```rust
pub mod error;
pub mod registry;
pub mod claude_cli;
pub mod tools;
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: compile error — `Registry`, `SessionEntry` not found.

- [ ] **Step 3: Implement types and load**

Replace `session-bridge/mcp-server/src/registry.rs` with:

```rust
//! Registry — load/save/prune/resolve_ref/set_alias.
//!
//! On-disk layout (mirrors session-bridge/hooks/lib.sh):
//!   ~/.claude/sessions/active.json — {"version":1,"sessions":{<id>:{...}}}
//!   ~/.claude/sessions/.lock       — flock target.

use crate::error::{BridgeError, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntry {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    pub branch: String,
    pub pid: i32,
    pub started_at: i64,
    #[serde(default)]
    pub alias: Option<String>,
    pub instance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub version: u32,
    pub sessions: BTreeMap<String, SessionEntry>,
}

impl Default for Registry {
    fn default() -> Self {
        Self { version: 1, sessions: BTreeMap::new() }
    }
}

pub fn default_registry_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".claude/sessions/active.json")
}

pub fn default_lock_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".claude/sessions/.lock")
}

/// Load the registry under a shared flock. Returns an empty registry if the file does not exist.
pub fn load(path: &Path, lock: &Path) -> Result<Registry> {
    if !path.exists() {
        return Ok(Registry::default());
    }
    let lock_file = OpenOptions::new().read(true).write(true).create(true).open(lock)?;
    lock_file.lock_shared()?;
    let mut buf = String::new();
    File::open(path)?.read_to_string(&mut buf)?;
    let reg: Registry = serde_json::from_str(&buf)
        .map_err(|e| BridgeError::RegistryCorrupt(e.to_string()))?;
    lock_file.unlock()?;
    Ok(reg)
}

/// Save the registry under an exclusive flock via atomic rename.
pub fn save(path: &Path, lock: &Path, reg: &Registry) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let lock_file = OpenOptions::new().read(true).write(true).create(true).open(lock)?;
    lock_file.lock_exclusive()?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(serde_json::to_string_pretty(reg)?.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    lock_file.unlock()?;
    Ok(())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): registry types + load/save"
```

---

## Task 11: `registry.rs` — prune dead pids

**Files:**
- Modify: `session-bridge/mcp-server/src/registry.rs`
- Modify: `session-bridge/mcp-server/tests/registry.rs`

- [ ] **Step 1: Write the failing test**

Append to `session-bridge/mcp-server/tests/registry.rs`:

```rust
use session_bridge_mcp::registry::{prune_with, Registry, SessionEntry};
use std::collections::BTreeMap;

fn entry(id: &str, pid: i32) -> SessionEntry {
    SessionEntry {
        session_id: id.into(),
        transcript_path: format!("/tmp/{}.jsonl", id),
        cwd: "/tmp".into(),
        branch: "main".into(),
        pid,
        started_at: 0,
        alias: None,
        instance: "main".into(),
    }
}

#[test]
fn prune_removes_dead_pids_only() {
    let mut sessions = BTreeMap::new();
    sessions.insert("a".into(), entry("a", 1));
    sessions.insert("b".into(), entry("b", 2));
    sessions.insert("c".into(), entry("c", 3));
    let mut reg = Registry { version: 1, sessions };

    // Liveness: pid 2 is dead.
    let pruned = prune_with(&mut reg, |pid| pid != 2);
    assert_eq!(pruned, vec!["b".to_string()]);
    assert_eq!(reg.sessions.len(), 2);
    assert!(reg.sessions.contains_key("a"));
    assert!(reg.sessions.contains_key("c"));
}

#[test]
fn prune_noop_when_all_alive() {
    let mut sessions = BTreeMap::new();
    sessions.insert("a".into(), entry("a", 1));
    let mut reg = Registry { version: 1, sessions };
    let pruned = prune_with(&mut reg, |_| true);
    assert!(pruned.is_empty());
    assert_eq!(reg.sessions.len(), 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: compile error — `prune_with` not found.

- [ ] **Step 3: Implement prune**

Append to `session-bridge/mcp-server/src/registry.rs`:

```rust
/// Drop sessions whose pid fails the liveness predicate. Returns the removed ids.
/// The closure form makes this testable without spawning real processes.
pub fn prune_with<F>(reg: &mut Registry, mut alive: F) -> Vec<String>
where F: FnMut(i32) -> bool
{
    let dead: Vec<String> = reg.sessions
        .iter()
        .filter(|(_, e)| !alive(e.pid))
        .map(|(k, _)| k.clone())
        .collect();
    for id in &dead {
        reg.sessions.remove(id);
    }
    dead
}

/// Real liveness check used in production: `kill(pid, 0)` via nix.
pub fn pid_alive(pid: i32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid), None).is_ok()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): prune dead-pid entries from registry"
```

---

## Task 12: `registry.rs` — resolve_ref

**Files:**
- Modify: `session-bridge/mcp-server/src/registry.rs`
- Modify: `session-bridge/mcp-server/tests/registry.rs`

- [ ] **Step 1: Write the failing test**

Append to `session-bridge/mcp-server/tests/registry.rs`:

```rust
use session_bridge_mcp::registry::resolve_ref;
use session_bridge_mcp::error::BridgeError;

fn fixture() -> Registry {
    let mut sessions = BTreeMap::new();
    let mut a = entry("abc-123", 1);
    a.cwd = "/home/u/work/foo".into();
    a.alias = Some("foo-session".into());
    let mut b = entry("def-456", 2);
    b.cwd = "/home/u/work/bar".into();
    sessions.insert("abc-123".into(), a);
    sessions.insert("def-456".into(), b);
    Registry { version: 1, sessions }
}

#[test]
fn resolve_by_full_id() {
    let reg = fixture();
    let e = resolve_ref(&reg, "abc-123").unwrap();
    assert_eq!(e.session_id, "abc-123");
}

#[test]
fn resolve_by_id_prefix() {
    let reg = fixture();
    let e = resolve_ref(&reg, "def").unwrap();
    assert_eq!(e.session_id, "def-456");
}

#[test]
fn resolve_by_alias() {
    let reg = fixture();
    let e = resolve_ref(&reg, "foo-session").unwrap();
    assert_eq!(e.session_id, "abc-123");
}

#[test]
fn resolve_by_cwd_substring() {
    let reg = fixture();
    let e = resolve_ref(&reg, "work/bar").unwrap();
    assert_eq!(e.session_id, "def-456");
}

#[test]
fn resolve_not_found() {
    let reg = fixture();
    let err = resolve_ref(&reg, "nope").unwrap_err();
    matches!(err, BridgeError::SessionNotFound(_, _));
}

#[test]
fn resolve_ambiguous() {
    let reg = fixture();
    // "work" matches both cwds.
    let err = resolve_ref(&reg, "work").unwrap_err();
    matches!(err, BridgeError::AmbiguousRef(_, _));
}

#[test]
fn resolve_full_id_wins_over_substring() {
    let reg = fixture();
    // Exact id wins even if it would also be a substring of something.
    let e = resolve_ref(&reg, "abc-123").unwrap();
    assert_eq!(e.session_id, "abc-123");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: compile error — `resolve_ref` not found.

- [ ] **Step 3: Implement resolve_ref**

Append to `session-bridge/mcp-server/src/registry.rs`:

```rust
/// Resolve a user-supplied reference to a single session entry.
/// Resolution order:
///   1. Exact session_id match
///   2. Exact alias match
///   3. Substring match across {session_id prefix, alias, cwd}
/// Multiple matches in step 3 → AmbiguousRef. Zero matches → SessionNotFound.
pub fn resolve_ref<'a>(reg: &'a Registry, query: &str) -> Result<&'a SessionEntry> {
    if let Some(e) = reg.sessions.get(query) {
        return Ok(e);
    }
    for e in reg.sessions.values() {
        if e.alias.as_deref() == Some(query) {
            return Ok(e);
        }
    }
    let matches: Vec<&SessionEntry> = reg.sessions.values()
        .filter(|e| {
            e.session_id.starts_with(query)
                || e.alias.as_deref().map(|a| a.contains(query)).unwrap_or(false)
                || e.cwd.contains(query)
        })
        .collect();
    match matches.len() {
        0 => Err(BridgeError::SessionNotFound(
            query.to_string(),
            reg.sessions.keys().cloned().collect(),
        )),
        1 => Ok(matches[0]),
        _ => Err(BridgeError::AmbiguousRef(
            query.to_string(),
            matches.iter().map(|e| e.session_id.clone()).collect(),
        )),
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): registry resolve_ref with id/alias/cwd matching"
```

---

## Task 13: `registry.rs` — set_alias

**Files:**
- Modify: `session-bridge/mcp-server/src/registry.rs`
- Modify: `session-bridge/mcp-server/tests/registry.rs`

- [ ] **Step 1: Write the failing test**

Append to `session-bridge/mcp-server/tests/registry.rs`:

```rust
use session_bridge_mcp::registry::set_alias_in;

#[test]
fn set_alias_updates_existing_entry() {
    let mut reg = fixture();
    set_alias_in(&mut reg, "abc-123", Some("renamed".into())).unwrap();
    assert_eq!(reg.sessions["abc-123"].alias.as_deref(), Some("renamed"));
}

#[test]
fn set_alias_clears_when_none() {
    let mut reg = fixture();
    set_alias_in(&mut reg, "abc-123", None).unwrap();
    assert_eq!(reg.sessions["abc-123"].alias, None);
}

#[test]
fn set_alias_errors_on_unknown_session() {
    let mut reg = fixture();
    let err = set_alias_in(&mut reg, "missing", Some("x".into())).unwrap_err();
    matches!(err, BridgeError::SessionNotFound(_, _));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: compile error — `set_alias_in` not found.

- [ ] **Step 3: Implement set_alias_in**

Append to `session-bridge/mcp-server/src/registry.rs`:

```rust
/// In-memory alias write. The MCP tool wraps this with load/save under flock.
pub fn set_alias_in(reg: &mut Registry, session_id: &str, alias: Option<String>) -> Result<()> {
    match reg.sessions.get_mut(session_id) {
        Some(e) => { e.alias = alias; Ok(()) }
        None => Err(BridgeError::SessionNotFound(
            session_id.to_string(),
            reg.sessions.keys().cloned().collect(),
        )),
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test registry --quiet
```

Expected: `14 passed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): set_alias_in"
```

---

## Task 14: `claude_cli.rs` — argv builder + spawn + timeout

**Files:**
- Modify: `session-bridge/mcp-server/src/claude_cli.rs`
- Test: `session-bridge/mcp-server/tests/claude_cli.rs`

- [ ] **Step 1: Write the failing test**

Write `session-bridge/mcp-server/tests/claude_cli.rs`:

```rust
use session_bridge_mcp::claude_cli::{build_argv, AskMode, AskSpec};
use std::path::PathBuf;

#[test]
fn ephemeral_argv_uses_copied_transcript_and_restricts_tools() {
    let spec = AskSpec {
        mode: AskMode::Ephemeral { transcript_copy: PathBuf::from("/tmp/copy.jsonl") },
        session_id: "abc-123".into(),
        cwd: PathBuf::from("/work"),
        prompt: "hello".into(),
        timeout_s: 60,
    };
    let argv = build_argv(&spec);
    // Flags pinned per session-bridge/docs/claude-cli-probe.md; update there before changing here.
    assert!(argv.contains(&"--resume".to_string()));
    assert!(argv.contains(&"/tmp/copy.jsonl".to_string()));
    assert!(argv.windows(2).any(|w| w[0] == "--allowed-tools"));
    assert!(argv.last().map(|s| s == "hello").unwrap_or(false));
}

#[test]
fn bidirectional_argv_uses_session_id_and_no_tool_restriction() {
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "abc-123".into(),
        cwd: PathBuf::from("/work"),
        prompt: "hi".into(),
        timeout_s: 60,
    };
    let argv = build_argv(&spec);
    assert!(argv.contains(&"--resume".to_string()));
    assert!(argv.contains(&"abc-123".to_string()));
    assert!(!argv.iter().any(|s| s == "--allowed-tools"));
}

#[tokio::test]
async fn spawn_captures_mock_stdout() {
    use session_bridge_mcp::claude_cli::run_with_binary;
    let tmp = tempfile::tempdir().unwrap();
    let script = tmp.path().join("claude");
    std::fs::write(&script, "#!/usr/bin/env bash\necho 'mock answer'\n").unwrap();
    std::os::unix::fs::PermissionsExt::set_mode(
        &mut std::fs::metadata(&script).unwrap().permissions(),
        0o755,
    );
    // Easier: use std::fs::set_permissions.
    std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();

    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "id".into(),
        cwd: tmp.path().to_path_buf(),
        prompt: "x".into(),
        timeout_s: 5,
    };
    let out = run_with_binary(script.to_str().unwrap(), &spec).await.unwrap();
    assert!(out.contains("mock answer"));
}

#[tokio::test]
async fn spawn_times_out() {
    let tmp = tempfile::tempdir().unwrap();
    let script = tmp.path().join("claude");
    std::fs::write(&script, "#!/usr/bin/env bash\nsleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "id".into(),
        cwd: tmp.path().to_path_buf(),
        prompt: "x".into(),
        timeout_s: 1,
    };
    let err = session_bridge_mcp::claude_cli::run_with_binary(script.to_str().unwrap(), &spec)
        .await.unwrap_err();
    matches!(err, session_bridge_mcp::error::BridgeError::Timeout(_));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test claude_cli --quiet
```

Expected: compile errors — `claude_cli::{build_argv, AskMode, AskSpec, run_with_binary}` not defined.

- [ ] **Step 3: Implement claude_cli**

Replace `session-bridge/mcp-server/src/claude_cli.rs` with:

```rust
//! Spawn `claude -p --resume …` with a timeout. Pure argv builder + thin async runner.
//!
//! Flags pinned by session-bridge/docs/claude-cli-probe.md. Update the probe doc
//! AND this file together if the CLI surface changes.

use crate::error::{BridgeError, Result};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub enum AskMode {
    /// Read-only fork: --resume <copy of transcript>, tools restricted.
    Ephemeral { transcript_copy: PathBuf },
    /// In-place: --resume <session_id>, no tool restriction. Caller must hold the lock.
    Bidirectional,
}

#[derive(Debug, Clone)]
pub struct AskSpec {
    pub mode: AskMode,
    pub session_id: String,
    pub cwd: PathBuf,
    pub prompt: String,
    pub timeout_s: u64,
}

/// Build the argv for `claude` (binary excluded). Pure — no I/O.
pub fn build_argv(spec: &AskSpec) -> Vec<String> {
    let mut argv = vec!["-p".to_string()];
    match &spec.mode {
        AskMode::Ephemeral { transcript_copy } => {
            argv.push("--resume".into());
            argv.push(transcript_copy.to_string_lossy().into_owned());
            argv.push("--allowed-tools".into());
            argv.push("Read,Grep,Glob,WebFetch".into());
            argv.push("--max-turns".into());
            argv.push("1".into());
        }
        AskMode::Bidirectional => {
            argv.push("--resume".into());
            argv.push(spec.session_id.clone());
        }
    }
    argv.push("--".into());
    argv.push(spec.prompt.clone());
    argv
}

/// Spawn the given binary with argv from `build_argv`, capture stdout, enforce timeout.
pub async fn run_with_binary(bin: &str, spec: &AskSpec) -> Result<String> {
    let argv = build_argv(spec);
    let mut cmd = Command::new(bin);
    cmd.args(&argv).current_dir(&spec.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => BridgeError::ClaudeCliMissing,
        _ => BridgeError::Io(e),
    })?;
    let mut stdout = child.stdout.take().unwrap();
    let dur = Duration::from_secs(spec.timeout_s);
    let result = timeout(dur, async {
        let mut buf = String::new();
        stdout.read_to_string(&mut buf).await?;
        let status = child.wait().await?;
        if !status.success() {
            // Non-zero from claude — return stdout we have; caller decides.
        }
        Ok::<String, std::io::Error>(buf)
    }).await;
    match result {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(e)) => Err(BridgeError::Io(e)),
        Err(_) => {
            let _ = child.start_kill();
            Err(BridgeError::Timeout(spec.timeout_s))
        }
    }
}

/// Resolve the system `claude` binary path.
pub fn locate_claude_binary() -> Result<String> {
    if let Ok(v) = std::env::var("SESSION_BRIDGE_CLAUDE_BIN") {
        return Ok(v);
    }
    which::which("claude")
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| BridgeError::ClaudeCliMissing)
}
```

Add `which = "6"` to `[dependencies]` in `Cargo.toml`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd session-bridge/mcp-server && cargo test --test claude_cli --quiet
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): claude_cli argv + spawn + timeout"
```

---

## Task 15: `tools.rs` — MCP tool handlers

**Files:**
- Modify: `session-bridge/mcp-server/src/tools.rs`
- Test: append to `session-bridge/mcp-server/tests/claude_cli.rs` (covers integration)

- [ ] **Step 1: Implement tool functions**

Replace `session-bridge/mcp-server/src/tools.rs` with:

```rust
//! MCP tool handlers — list_sessions, ask_session, set_alias.
//! Pure-ish: take dependencies as parameters so the rmcp wiring in main.rs is thin.

use crate::claude_cli::{locate_claude_binary, run_with_binary, AskMode, AskSpec};
use crate::error::{BridgeError, Result};
use crate::registry::{
    default_lock_path, default_registry_path, load, pid_alive, prune_with,
    resolve_ref, save, set_alias_in, SessionEntry,
};
use fs2::FileExt;
use serde::Serialize;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
pub struct SessionListItem {
    pub session_id: String,
    pub cwd: String,
    pub branch: String,
    pub alias: Option<String>,
    pub instance: String,
    pub started_at: i64,
    pub age_seconds: i64,
}

#[derive(Debug, Serialize)]
pub struct AskResult {
    pub answer: String,
    pub session_id: String,
    pub mode: &'static str,
    pub duration_ms: u128,
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn list_sessions() -> Result<Vec<SessionListItem>> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = match load(&path, &lock) {
        Ok(r) => r,
        Err(BridgeError::RegistryCorrupt(_)) => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let removed = prune_with(&mut reg, pid_alive);
    if !removed.is_empty() {
        save(&path, &lock, &reg)?;
    }
    let now = now_secs();
    let mut items: Vec<SessionListItem> = reg.sessions.values().map(|e| SessionListItem {
        session_id: e.session_id.clone(),
        cwd: e.cwd.clone(),
        branch: e.branch.clone(),
        alias: e.alias.clone(),
        instance: e.instance.clone(),
        started_at: e.started_at,
        age_seconds: now - e.started_at,
    }).collect();
    items.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(items)
}

pub async fn ask_session(reference: &str, prompt: &str, mode: &str, timeout_s: u64) -> Result<AskResult> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = load(&path, &lock)?;
    if reg.sessions.is_empty() {
        return Err(BridgeError::NoSessionsRegistered);
    }
    // Prune so a stale pid doesn't waste a fork.
    let removed = prune_with(&mut reg, pid_alive);
    if !removed.is_empty() {
        save(&path, &lock, &reg)?;
    }
    let entry: SessionEntry = resolve_ref(&reg, reference)?.clone();
    if !pid_alive(entry.pid) {
        return Err(BridgeError::SessionDied(entry.session_id, entry.pid));
    }
    let bin = locate_claude_binary()?;

    let started = std::time::Instant::now();
    let result = match mode {
        "ephemeral" => run_ephemeral(&bin, &entry, prompt, timeout_s).await,
        "bidirectional" => run_bidirectional(&bin, &entry, prompt, timeout_s).await,
        other => Err(BridgeError::RegistryCorrupt(format!("unknown mode {other}"))),
    };
    let duration_ms = started.elapsed().as_millis();
    let answer = result?;
    Ok(AskResult {
        answer,
        session_id: entry.session_id,
        mode: if mode == "ephemeral" { "ephemeral" } else { "bidirectional" },
        duration_ms,
    })
}

async fn run_ephemeral(bin: &str, entry: &SessionEntry, prompt: &str, timeout_s: u64) -> Result<String> {
    let copy = tempfile::Builder::new()
        .prefix("session-bridge-")
        .suffix(".jsonl")
        .tempfile()
        .map_err(|e| BridgeError::ForkFailed(e.to_string()))?;
    std::fs::copy(&entry.transcript_path, copy.path())
        .map_err(|e| BridgeError::ForkFailed(e.to_string()))?;
    let spec = AskSpec {
        mode: AskMode::Ephemeral { transcript_copy: copy.path().to_path_buf() },
        session_id: entry.session_id.clone(),
        cwd: PathBuf::from(&entry.cwd),
        prompt: prompt.to_string(),
        timeout_s,
    };
    let out = run_with_binary(bin, &spec).await;
    // tempfile drops on scope exit → cleanup guaranteed.
    out
}

async fn run_bidirectional(bin: &str, entry: &SessionEntry, prompt: &str, timeout_s: u64) -> Result<String> {
    // Serialize concurrent bidirectional asks on the same transcript via flock.
    let lock_file = OpenOptions::new().read(true).write(true).create(true)
        .open(&entry.transcript_path)?;
    if let Err(_) = lock_file.try_lock_exclusive() {
        // Block with the caller-supplied timeout budget on a spawned blocking thread.
        let lf = lock_file.try_clone()?;
        let got = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_s),
            tokio::task::spawn_blocking(move || lf.lock_exclusive()),
        ).await;
        match got {
            Ok(Ok(Ok(()))) => {}
            _ => return Err(BridgeError::SessionBusy(entry.session_id.clone())),
        }
    }
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: entry.session_id.clone(),
        cwd: PathBuf::from(&entry.cwd),
        prompt: prompt.to_string(),
        timeout_s,
    };
    let out = run_with_binary(bin, &spec).await;
    let _ = lock_file.unlock();
    out
}

pub fn set_alias(session_id: &str, alias: Option<String>) -> Result<()> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = load(&path, &lock)?;
    set_alias_in(&mut reg, session_id, alias)?;
    save(&path, &lock, &reg)?;
    Ok(())
}
```

- [ ] **Step 2: Add an integration test that exercises `list_sessions` via the registry on disk**

Append to `session-bridge/mcp-server/tests/claude_cli.rs`:

```rust
#[test]
fn list_sessions_reads_registry_and_prunes_dead_pids() {
    use session_bridge_mcp::registry::{save, Registry, SessionEntry};
    use std::collections::BTreeMap;
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path();
    std::env::set_var("HOME", home);
    let mut sessions = BTreeMap::new();
    let mut alive_pid = std::process::id() as i32;
    let mut dead_pid = 999_999; // assume not allocated
    sessions.insert("a".into(), SessionEntry {
        session_id: "a".into(),
        transcript_path: "/tmp/a.jsonl".into(),
        cwd: "/tmp".into(),
        branch: "main".into(),
        pid: alive_pid,
        started_at: 0,
        alias: None,
        instance: "main".into(),
    });
    sessions.insert("b".into(), SessionEntry {
        session_id: "b".into(),
        transcript_path: "/tmp/b.jsonl".into(),
        cwd: "/tmp".into(),
        branch: "main".into(),
        pid: dead_pid,
        started_at: 0,
        alias: None,
        instance: "main".into(),
    });
    let reg = Registry { version: 1, sessions };
    let reg_path = home.join(".claude/sessions/active.json");
    std::fs::create_dir_all(reg_path.parent().unwrap()).unwrap();
    let lock_path = home.join(".claude/sessions/.lock");
    save(&reg_path, &lock_path, &reg).unwrap();

    let items = session_bridge_mcp::tools::list_sessions().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].session_id, "a");
}
```

> The test sets `HOME` for the process. Run with `cargo test --test claude_cli -- --test-threads=1` since other tests in the same file may also rely on env.

- [ ] **Step 3: Run the tests**

Run:

```bash
cd session-bridge/mcp-server && cargo test -- --test-threads=1 --quiet
```

Expected: all tests pass (14 registry + 4 claude_cli + 1 list_sessions = 19).

- [ ] **Step 4: Commit**

```bash
git add session-bridge/mcp-server
git commit -m "feat(session-bridge): MCP tool handlers (list_sessions, ask_session, set_alias)"
```

---

## Task 16: `main.rs` — rmcp stdio bootstrap

**Files:**
- Modify: `session-bridge/mcp-server/src/main.rs`
- Modify: `session-bridge/.claude-plugin/plugin.json`

- [ ] **Step 1: Inspect the rmcp API available**

Run:

```bash
cd session-bridge/mcp-server && cargo doc --no-deps --offline 2>&1 | head -40 || true
cargo search rmcp --limit 1
```

Goal: confirm the `rmcp` version actually resolved and find the server bootstrap shape (`ServerHandler`, `tool!` macro, or builder). If the resolved API differs from what's coded below, adapt the bootstrap to it — the three handler functions in `tools.rs` are the stable surface, the rmcp glue is replaceable.

- [ ] **Step 2: Write the bootstrap**

Replace `session-bridge/mcp-server/src/main.rs` with:

```rust
//! session-bridge MCP server. stdio transport.
mod error;
mod registry;
mod claude_cli;
mod tools;

use rmcp::{ServerHandler, model::*, schemars, tool};
use serde::Deserialize;

#[derive(Debug, Default, Clone)]
struct Bridge;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AskArgs {
    /// session_id prefix, alias, or cwd substring
    r#ref: String,
    /// question text
    prompt: String,
    /// "ephemeral" (default) or "bidirectional"
    #[serde(default = "default_mode")]
    mode: String,
    /// max seconds to wait
    #[serde(default = "default_timeout")]
    timeout_s: u64,
}

fn default_mode() -> String { "ephemeral".into() }
fn default_timeout() -> u64 { 120 }

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AliasArgs {
    session_id: String,
    alias: Option<String>,
}

#[tool(tool_box)]
impl Bridge {
    #[tool(description = "List active Claude Code sessions registered on this machine.")]
    async fn list_sessions(&self) -> Result<CallToolResult, rmcp::Error> {
        let items = tools::list_sessions().map_err(to_rmcp)?;
        Ok(CallToolResult::success(vec![Content::json(serde_json::to_value(items).unwrap())]))
    }

    #[tool(description = "Ask a registered session a question in its loaded context. \
        mode=ephemeral copies the transcript and forks a one-shot read-only sub-claude. \
        mode=bidirectional resumes the producer session in-place, appending Q+A to its history.")]
    async fn ask_session(&self, #[tool(aggr)] a: AskArgs) -> Result<CallToolResult, rmcp::Error> {
        let res = tools::ask_session(&a.r#ref, &a.prompt, &a.mode, a.timeout_s).await.map_err(to_rmcp)?;
        Ok(CallToolResult::success(vec![Content::json(serde_json::to_value(res).unwrap())]))
    }

    #[tool(description = "Set or clear a friendly alias for a registered session.")]
    async fn set_alias(&self, #[tool(aggr)] a: AliasArgs) -> Result<CallToolResult, rmcp::Error> {
        tools::set_alias(&a.session_id, a.alias).map_err(to_rmcp)?;
        Ok(CallToolResult::success(vec![Content::text("ok".to_string())]))
    }
}

fn to_rmcp(e: error::BridgeError) -> rmcp::Error {
    rmcp::Error::invalid_params(e.to_string(), None)
}

#[tool(tool_box)]
impl ServerHandler for Bridge {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation::from_build_env(),
            instructions: Some(
                "session-bridge: list and query active Claude Code sessions. \
                 ask_session(ref, prompt) returns the answer; use mode=\"ephemeral\" \
                 to leave the producer's history untouched.".into()),
        }
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    use rmcp::transport::io::stdio;
    use rmcp::ServiceExt;
    Bridge::default().serve(stdio()).await?.waiting().await?;
    Ok(())
}
```

> If the resolved `rmcp` version exposes a different macro / handler shape, this is where to adapt. Keep `tools::{list_sessions, ask_session, set_alias}` as the call surface — they are tested.

- [ ] **Step 3: Wire `mcpServers` in plugin.json**

Replace `session-bridge/.claude-plugin/plugin.json` with:

```json
{
  "name": "session-bridge",
  "description": "Cross-session MCP bridge — ask one Claude Code session a question from another, in its loaded context.",
  "version": "0.1.0",
  "author": { "name": "Marius" },
  "license": "MIT",
  "keywords": ["mcp", "session", "rpc", "bridge"],
  "mcpServers": {
    "session-bridge": {
      "command": "${CLAUDE_PLUGIN_ROOT}/mcp-server/target/release/session-bridge-mcp",
      "args": []
    }
  }
}
```

- [ ] **Step 4: Build the release binary**

Run:

```bash
./session-bridge/scripts/build.sh
```

Expected: `cargo test` then `cargo build --release` both succeed; final line prints the binary path.

- [ ] **Step 5: Commit**

```bash
git add session-bridge/mcp-server session-bridge/.claude-plugin/plugin.json
git commit -m "feat(session-bridge): rmcp stdio server bootstrap + plugin manifest wiring"
```

---

## Task 17: `/sessions` slash command

**Files:**
- Create: `session-bridge/commands/sessions.md`

- [ ] **Step 1: Write the command**

Write `session-bridge/commands/sessions.md`:

```markdown
---
description: List active Claude Code sessions registered by session-bridge.
---

Call the `session-bridge.list_sessions` MCP tool and present the result as a compact table with columns: `instance`, `alias`, `session_id` (first 8 chars), `cwd`, `branch`, `age`.

If the tool returns an empty array, say so plainly: no other sessions are currently registered.
```

- [ ] **Step 2: Commit**

```bash
git add session-bridge/commands/sessions.md
git commit -m "feat(session-bridge): /sessions slash command"
```

---

## Task 18: README

**Files:**
- Modify: `session-bridge/README.md`

- [ ] **Step 1: Replace stub with full README**

Write `session-bridge/README.md`:

````markdown
# session-bridge

Cross-session MCP bridge for Claude Code. Each running session registers itself in `~/.claude/sessions/active.json`. Other sessions list and query it via MCP tools — answers come from a fork-resumed sub-`claude` running with the producer's loaded context.

## Install

Requires `cargo`, `jq`, `claude` CLI on PATH.

```bash
./session-bridge/scripts/build.sh        # cargo test + cargo build --release
```

Enable in your CC marketplace (see repo root `README.md`).

## Tools

- **`list_sessions`** — array of `{session_id, cwd, branch, alias, instance, started_at, age_seconds}`.
- **`ask_session(ref, prompt, mode="ephemeral", timeout_s=120)`** — `ref` matches by id prefix, alias, or cwd substring.
  - `mode="ephemeral"` (default): copies the transcript, forks a one-shot read-only sub-claude, returns the answer; producer history is not mutated. Sub-claude tools restricted to `Read,Grep,Glob,WebFetch`.
  - `mode="bidirectional"`: resumes the producer's session in-place; Q+A are appended to the producer's history; full tool access; serialized via flock on the transcript file.
- **`set_alias(session_id, alias)`** — assign a friendly name.

## Slash commands

- `/sessions` — list active sessions in a compact table.

## Manual end-to-end smoke test

In two terminals (`A` in `~/work/foo`, `B` in `~/work/bar`), start `claude` in each. Verify in B:

```
> /sessions          # B should see A in the list
> Ask A: what file did we last edit?    # invokes ask_session with mode=ephemeral
```

## Files

```
session-bridge/
├── .claude-plugin/plugin.json
├── hooks/{hooks.json, lib.sh, register.sh, unregister.sh}
├── mcp-server/{Cargo.toml, src/, tests/}
├── scripts/build.sh
├── commands/sessions.md
└── README.md
```

## Caveats

- Registry is local to one user account. No cross-machine support.
- `bidirectional` mode mutates the producer's session history. The producer's user will see the injected Q+A.
- Cold start: each `ask_session` spawns a new `claude` process. Latency = process start + context reload.
````

- [ ] **Step 2: Commit**

```bash
git add session-bridge/README.md
git commit -m "docs(session-bridge): README"
```

---

## Task 19: Marketplace registration + version table

**Files:**
- Modify: `.claude-plugin/marketplace.json` (repo root)
- Modify: `README.md` (repo root)

- [ ] **Step 1: Add the plugin to marketplace catalog**

Read `.claude-plugin/marketplace.json` and add a `session-bridge` entry following the same shape as `codescout-companion` and `buddy`. **Do not add a `version` field** (per repo CLAUDE.md: marketplace.json must never contain version fields).

- [ ] **Step 2: Add a row to the README version table**

Add `session-bridge` and version `0.1.0` to the table in repo root `README.md`.

- [ ] **Step 3: Run the version consistency check**

Run:

```bash
./scripts/check-versions.sh
```

Expected: exit 0.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
./tests/run-all.sh
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json README.md
git commit -m "feat(marketplace): register session-bridge 0.1.0"
```

---

## Task 20: Manual end-to-end verification

**Files:** none.

This task does not produce code. It documents the manual verification the implementer must perform before declaring the plan complete.

- [ ] **Step 1: Install the plugin in your `~/.claude` profile**

Follow the install path documented in repo CLAUDE.md (cache snapshot + `installed_plugins.json` update for all three profiles, if applicable). Restart Claude Code.

- [ ] **Step 2: Verify the SessionStart hook writes a registry entry**

In one CC session:

```bash
cat ~/.claude/sessions/active.json | jq .
```

Expected: an entry for the current session with `cwd`, `branch`, `pid`, `instance`.

- [ ] **Step 3: Verify `list_sessions` from a second session**

Start a second CC session in a different cwd. Run `/sessions`. Expected: table showing both sessions.

- [ ] **Step 4: Verify `ask_session` ephemeral mode**

From the second session, invoke `session-bridge.ask_session` with the first session's id-prefix and a question about its cwd (e.g. "what's the name of the project in this directory?"). Expected: a plausible answer; first session's history unchanged (`wc -l` on its transcript before/after is identical).

- [ ] **Step 5: Verify `ask_session` bidirectional mode**

Same question, `mode="bidirectional"`. Expected: answer returned; producer's transcript grew by 2 turns.

- [ ] **Step 6: Verify Stop hook removes the entry**

Exit the first session. In the second, run `/sessions`. Expected: only the second session listed; the first is gone from `active.json`.

- [ ] **Step 7: Verify stale-pid pruning**

Manually insert a fake entry with a dead pid into `active.json`, then call `list_sessions`. Expected: fake entry is silently pruned.

If any step fails, file the failure as a follow-up task with reproduction steps; do not silently patch.

---

## Self-review

- **Spec coverage:**
  - Registry layout + atomic write — Tasks 2, 4, 5, 6, 10
  - Pid pruning (cross-platform) — Task 11 (uses `nix::kill(pid, None)`)
  - resolve_ref — Task 12
  - Ephemeral vs bidirectional mode — Task 14 (argv), Task 15 (orchestration)
  - flock on transcript for bidirectional — Task 15 (`run_bidirectional`)
  - Tool surface (`list_sessions`, `ask_session`, `set_alias`) — Tasks 15, 16
  - Error matrix — codified in `error.rs` Task 9; surfaced by handlers in 15
  - Tests: Rust unit + integration + bash hook tests + concurrency — Tasks 4, 5, 6, 10–15
  - Open question 1 (claude CLI flags) — Task 8 probes, Task 14 pins
  - macOS portability — Task 11 (`nix::kill`)
- **Placeholder scan:** Task 16 leaves the rmcp bootstrap adaptable to the resolved crate API; this is intentional (the macro shape depends on `rmcp` version) and is constrained to a single file with stable downstream tests. Not a TODO in disguise — the implementer has working tests to drive convergence.
- **Type consistency:** `Registry`/`SessionEntry` defined Task 10, used 11–15. `AskMode`/`AskSpec` defined Task 14, used 15. `BridgeError` variants defined Task 9, used everywhere.
