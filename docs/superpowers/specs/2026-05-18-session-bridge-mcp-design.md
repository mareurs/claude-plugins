# session-bridge — Cross-Session MCP Bridge

**Date:** 2026-05-18
**Status:** Design, approved for planning
**Plugin:** `session-bridge/` (new)

## Problem

A user running multiple Claude Code (CC) sessions across different projects has no way for one session to ask another a question in its own context. Useful when work in project A needs an answer informed by the state, conversation history, and CLAUDE.md of project B without manually switching sessions and losing flow.

## Goal

Ship a CC plugin that lets any local session enumerate other active local sessions and ask them questions via MCP. The producer's loaded context (transcript, cwd, CLAUDE.md) informs the answer.

## Non-goals

- Cross-machine RPC.
- Streaming token output (request/response only).
- Auth between sessions (same user, same machine — trust the filesystem).
- Producer "do not disturb" gating (defer).
- Long-lived daemon (defer; current design is per-call subprocess).

## Architecture

Plugin name: **`session-bridge`**. Lives at `session-bridge/` in this repo. Every CC instance installs the same plugin and is potentially both producer (its session is callable) and consumer (it can call other sessions).

Three components:

1. **SessionStart hook (bash)** — registers the session in `~/.claude/sessions/active.json`.
2. **Stop hook (bash)** — unregisters on session end.
3. **MCP server (Rust binary)** — declared in `plugin.json`, started per CC instance over stdio. Exposes `list_sessions`, `ask_session`, `set_alias`.

The MCP server is stateless. The registry file is the only shared state. Concurrency is handled with `flock(2)` on a lock file alongside the registry.

`ask_session` works by **fork-resume**: the MCP server spawns a headless `claude -p --resume …` subprocess pointed at the producer's transcript. Two modes:

- **ephemeral (default)** — transcript is copied to a tmp file and `--resume`d there. Producer history is untouched. Tools restricted to read-only (`Read,Grep,Glob,WebFetch`).
- **bidirectional** — `--resume` directly against producer's session-id. Q+A append to producer history. Tools inherit producer defaults. Serialized via `flock` on the transcript file.

## Registry

**Path:** `~/.claude/sessions/active.json`
**Lock:** `~/.claude/sessions/.lock`
**Directory perms:** 0700 (created if missing).

**Schema:**

```json
{
  "version": 1,
  "sessions": {
    "<session-uuid>": {
      "session_id": "<uuid>",
      "transcript_path": "/home/u/.claude/projects/<slug>/<uuid>.jsonl",
      "cwd": "/home/u/work/foo",
      "branch": "main",
      "pid": 12345,
      "started_at": 1747526400,
      "alias": null,
      "instance": "main"
    }
  }
}
```

`instance` ∈ {`main`, `sdd`, `kat`, …} — derived from `$CLAUDE_CONFIG_DIR` or, failing that, from the `$HOME/.claude{,-sdd,-kat}/` prefix on `transcript_path`.

**Write protocol (hooks):** `flock -x` on `.lock`, read → mutate → write to `active.json.tmp` → atomic `mv` over `active.json`. Implemented with `jq` in bash.

**Read protocol (Rust):** `flock` shared, parse, prune entries whose `pid` no longer exists (`kill(pid, 0)` via the `nix` crate for cross-platform), write back if any entries pruned, release lock.

## MCP tool surface

### `list_sessions()`

Returns array of registry entries sorted by `started_at` desc, with `age_seconds` computed. Empty array if registry missing.

### `ask_session(ref, prompt, mode="ephemeral", timeout_s=120)`

- `ref` — session-id prefix, alias, or substring of `cwd`. Ambiguity → error `ambiguous_ref` listing matches.
- `prompt` — question text.
- `mode` — `"ephemeral"` or `"bidirectional"`.
- `timeout_s` — kill subprocess after this many seconds.

Returns `{answer, session_id, mode, duration_ms}` on success.

**Ephemeral flow:**

1. Resolve `ref` → entry.
2. `cp <transcript_path> $TMPDIR/session-bridge-<rand>.jsonl`.
3. Spawn `claude -p --resume <tmp_path> --allowed-tools Read,Grep,Glob,WebFetch --max-turns 1 -- "<prompt>"` with `cwd = entry.cwd`. Exact flag surface to be verified during planning (see open questions).
4. Capture stdout. On timeout, SIGTERM then SIGKILL after grace period.
5. Delete tmp file in all paths (success, error, timeout).

**Bidirectional flow:**

1. Resolve `ref`.
2. Acquire `flock -x` on producer's transcript file with `timeout_s` cap → `session_busy` if exhausted.
3. Spawn `claude -p --resume <session_id>`, cwd = `entry.cwd`, no tool restriction.
4. Release lock when subprocess exits.

### `set_alias(session_id, alias)`

Convenience: writes `alias` field for a session. Useful when the consumer wants a stable name independent of cwd.

## Components & file layout

```
session-bridge/
├── .claude-plugin/
│   └── plugin.json           # name, version, mcpServers entry
├── hooks/
│   ├── hooks.json            # SessionStart → register.sh, Stop → unregister.sh
│   ├── register.sh
│   ├── unregister.sh
│   └── lib.sh                # registry path, flock helper, jq idioms
├── mcp-server/
│   ├── Cargo.toml            # rmcp, serde, serde_json, tokio, anyhow, nix, fs2
│   ├── src/
│   │   ├── main.rs           # stdio server bootstrap
│   │   ├── registry.rs       # load / prune / resolve_ref
│   │   ├── tools.rs          # list_sessions, ask_session, set_alias
│   │   └── claude_cli.rs     # spawn `claude -p --resume`, timeout, cleanup
│   └── tests/
│       ├── registry.rs
│       └── claude_cli.rs     # mock binary via $PATH
├── scripts/
│   └── build.sh              # cargo build --release; print binary path
├── commands/
│   └── sessions.md           # /sessions slash command → list_sessions
├── tests/
│   ├── test-register.sh
│   ├── test-concurrent.sh
│   └── lib/                  # reuse repo's fixtures.sh
└── README.md
```

**`plugin.json` mcpServers block:**

```json
{
  "name": "session-bridge",
  "version": "0.1.0",
  "mcpServers": {
    "session-bridge": {
      "command": "${CLAUDE_PLUGIN_ROOT}/mcp-server/target/release/session-bridge-mcp",
      "args": []
    }
  }
}
```

**Unit boundaries:**

- `registry.rs` — pure: load, prune, resolve ref. No subprocess. Testable without `claude` installed.
- `claude_cli.rs` — pure: build argv, spawn, capture, enforce timeout, cleanup tmp. Takes a `Command`-builder seam for tests.
- `tools.rs` — thin glue: combines `registry` + `claude_cli` into MCP tool responses.
- Hooks: bash, no Rust dependency. Registry schema is documented in `registry.rs` doc-comment and mirrored in `lib.sh` comment.

## Error handling

| Failure | Behavior |
|---|---|
| Registry file missing | `list_sessions` → `[]`; `ask_session` → `no_sessions_registered` |
| Malformed JSON | Quarantine to `active.json.corrupt-<ts>`, start fresh, log to stderr |
| `ref` resolves to 0 entries | `session_not_found`, include current list |
| `ref` resolves to >1 entries | `ambiguous_ref`, include matches |
| `pid` dead at call time | Prune entry, return `session_died` |
| `claude` binary missing from PATH | `claude_cli_missing` with install hint |
| Subprocess timeout | SIGTERM → SIGKILL, return `{error: timeout, partial_stdout}` |
| Bidirectional lock contention | Wait up to `timeout_s`; if still locked, `session_busy` |
| Tmp copy fails (disk full) | `fork_failed`, no producer mutation |
| Hook `flock` timeout (10s) | Hook exits 0, logs to stderr — never block CC startup |

## Testing

- **Rust unit** (`mcp-server/tests/`): registry round-trip; prune-dead-pid (inject a liveness trait); resolve_ref ambiguity; argv construction for both modes.
- **Rust integration**: place a mock `claude` script earlier on `$PATH` that echoes a canned answer; assert subprocess wiring, timeout kills child, tmp file cleanup in success/error/timeout paths.
- **Bash hook tests** (`tests/`, reusing `tests/lib/fixtures.sh`): `register.sh` writes a valid entry; `unregister.sh` removes by id; two `register.sh` runs in parallel both land (flock works).
- **End-to-end (manual, documented in README)**: two CC instances in different cwds, `list_sessions` shows both, `ask_session` returns a plausible answer in each mode.

Wire bash tests into `tests/run-all.sh`. Rust tests run via `cargo test` in `mcp-server/`; `scripts/build.sh` invokes `cargo test` before `cargo build --release`.

## Dependencies

- `jq`, `bash`, `flock` (already required by other plugins in this repo).
- `cargo` / Rust toolchain (new — documented in README, validated by `build.sh`).
- `claude` CLI on `$PATH` at runtime for `ask_session`.

## Open questions (resolved in planning phase, not blocking spec)

1. **`claude -p --resume` flag surface.** Verify whether `--resume` accepts a file path or only a session-id; whether `--allowed-tools` is honored in `-p` mode; whether `--cwd` exists or `$PWD` / `cd` is the right knob; whether `--max-turns 1` exists. Probe `claude --help` and pin exact flags in `claude_cli.rs`.
2. **Session-id source in hooks.** Confirm CC's current hook contract: env var `$CLAUDE_SESSION_ID`, JSON on stdin, or only `transcript_path` argument. Fall back to parsing the transcript-path basename.
3. **`instance` detection.** `$CLAUDE_CONFIG_DIR` if set; else prefix-match on `transcript_path`. Edge case: non-standard `CLAUDE_CONFIG_DIR` values.
4. **macOS portability.** Use `nix::sys::signal::kill(pid, None)` for liveness on both Linux and macOS rather than `/proc/<pid>`.
5. **Plugin install path.** Per repo CLAUDE.md, directory-source plugins freeze `installPath` at install time. Built binary lives under `installPath/mcp-server/target/release/`. Document this and add to the version-bump checklist tracker (`cc8cb9e23ab5cc67`) so cache directories include the prebuilt binary or trigger a build step.

## Future work (not in this spec)

- **Approach B — long-lived daemon.** If cold-start latency of `claude -p --resume` proves painful, swap `claude_cli.rs` for a unix-socket client to a warm worker daemon. MCP tool surface stays identical.
- **Do-not-disturb flag.** Producer flips a bit in its registry entry; consumer queries error early.
- **Streaming.** Switch MCP response to streaming once the request/response baseline is stable.
- **Cross-machine.** Replace registry file with a small networked broker.
