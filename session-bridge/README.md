# session-bridge

Cross-session MCP bridge for Claude Code. Each running session registers itself in `~/.claude/sessions/active.json`. Other sessions list and query it via MCP tools — answers come from a fork-resumed sub-`claude` running with the producer's loaded context.

## Install

Requires `cargo`, `jq`, `claude` CLI on PATH.

```bash
./session-bridge/scripts/build.sh        # cargo test + cargo build --release
```

Enable in your CC marketplace (see repo root `README.md`).

## How it works

- **SessionStart hook** (`hooks/register.sh`) writes the running session's id, cwd, branch, pid, transcript path, and instance (main/sdd/kat) into `~/.claude/sessions/active.json` under a flock.
- **Stop hook** (`hooks/unregister.sh`) removes the entry.
- **MCP server** (`mcp-server/`, Rust + rmcp, stdio) reads the registry and spawns `claude -p --resume …` to answer queries.

`ask_session` modes:

- **`ephemeral`** (default) — spawns `claude -p --resume <id> --fork-session --no-session-persistence --allowed-tools "Read,Grep,Glob,WebFetch"`. The fork inherits the producer's conversation but writes nothing back; tools are read-only.
- **`bidirectional`** — spawns `claude -p --resume <id>` directly; Q+A append to the producer's history; full tool access. Serialized via `flock` on the transcript file.

## Tools

- **`list_sessions`** — array of `{session_id, cwd, branch, alias, instance, started_at, age_seconds}`.
- **`ask_session(ref, prompt, mode="ephemeral", timeout_s=120)`** — `ref` matches by id prefix, alias, or cwd substring.
- **`set_alias(session_id, alias)`** — assign a friendly name.

## Slash commands

- `/sessions` — list active sessions in a compact table.

## Manual end-to-end smoke test

In two terminals (`A` in `~/work/foo`, `B` in `~/work/bar`), start `claude` in each. From B:

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
├── docs/claude-cli-probe.md
└── README.md
```

## Caveats

- Local user only — registry lives in `$HOME`, no cross-machine support.
- `bidirectional` mode mutates the producer's session history. The producer's user will see the injected Q+A.
- Cold start: each `ask_session` spawns a new `claude` process. Latency = process start + context reload. If this becomes painful, a long-lived daemon variant is sketched in the spec.

## Spec

`docs/superpowers/specs/2026-05-18-session-bridge-mcp-design.md` (in the repo root `docs/`).
