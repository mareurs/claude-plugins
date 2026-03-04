# Hook Testing Design

**Date:** 2026-03-04
**Status:** Approved

## Problem

The plugin has 6 hook scripts with no automated tests. Changes are validated manually
by running Claude Code and observing behavior, which is slow, imprecise, and only catches
obvious breakage. We want to catch regressions and validate new changes before pushing.

## Approach

**Option C: Fixture library + per-hook test scripts (plain bash, modular)**

- `tests/lib/fixtures.sh` — shared helpers for fixture setup and assertions
- One test script per hook
- `tests/run-all.sh` — runs all scripts, aggregates results, exits 1 on failure
- No extra dependencies beyond bash, jq, git, sqlite3 (already required by the hooks)
- Tests are run manually before each push/version bump

All hooks share the same interface: JSON on stdin → JSON on stdout + exit code.
Tests pipe crafted JSON input, assert on the output JSON and filesystem side effects.

## Directory Structure

```
tests/
  lib/
    fixtures.sh
  test-session-start.sh
  test-pre-tool-guard.sh
  test-worktree-write-guard.sh
  test-worktree-activate.sh
  test-ce-activate-project.sh
  test-subagent-guidance.sh
  run-all.sh
```

## Fixture Library API (`tests/lib/fixtures.sh`)

### Setup helpers

All tests create a `TMPDIR=$(mktemp -d)` and register `trap 'rm -rf "$TMPDIR"' EXIT`.

```bash
make_git_repo <dir>                 # git init + initial commit (HEAD + rev-parse work)
make_worktree <main_dir> <wt_dir>   # git worktree add (git-common-dir ≠ git-dir)
write_mcp_json <dir> <server_name>  # .mcp.json with code-explorer entry + dummy binary
write_routing_config <dir> <json>   # .claude/code-explorer-routing.json
make_ce_dir <dir>                   # .code-explorer/project.toml (marks as onboarded)
make_memories <dir>                 # .code-explorer/memories/arch.md, patterns.md
make_system_prompt <dir>            # .code-explorer/system-prompt.md with known content
seed_sqlite_db <db_path> <commit>   # minimal SQLite DB: meta table with last_indexed_commit
                                    # optionally with drift_report rows for drift tests
make_pending_marker <wt_dir>        # touch <wt_dir>/.ce-worktree-pending
```

### Assertion helpers

```bash
assert_context_contains <output> <string>  # additionalContext field includes string
assert_denied <output>                     # permissionDecision == "deny"
assert_allowed <output>                    # exit 0 + no deny in output
assert_no_output <output>                  # hook produced no stdout
pass <test_name>                           # record pass, print "PASS: <name>"
fail <test_name> <reason>                  # record fail, print "FAIL: <name>: <reason>"
```

Counters `PASS_COUNT` and `FAIL_COUNT` are global, accumulated across all scripts via
`run-all.sh` sourcing the library once.

## Test Scenarios

### `test-session-start.sh` (8 tests)

| # | Setup | Expected |
|---|-------|----------|
| 1 | No MCP config | Silent exit (no output) |
| 2 | CE configured, no `project.toml` | Context contains "not yet onboarded" |
| 3 | CE configured, `memories/` dir exists | Context contains "CE MEMORIES:" |
| 4 | CE configured, `system-prompt.md` exists | Context contains its known content |
| 5 | Index stale (`last_indexed_commit` ≠ HEAD) | Context contains "INDEX: Refreshing" |
| 6 | Index current (`last_indexed_commit` == HEAD) | No "INDEX:" in context |
| 7 | CWD is inside a real git worktree | Context contains "WORKTREE SESSION:", no INDEX |
| 8 | `drift_detection_enabled = true`, high-drift rows in DB | Context contains "DRIFT WARNING" |

### `test-pre-tool-guard.sh` (10 tests)

| # | Tool + Input | Expected |
|---|-------------|----------|
| 1 | Any tool, no CE configured | Allow (exit 0, no deny) |
| 2 | `Bash`, any command | Deny, reason contains "run_command" |
| 3 | `Grep`, `type=ts` | Deny, reason contains "find_symbol" |
| 4 | `Grep`, glob `**/*.md` | Allow |
| 5 | `Glob`, pattern `**/*.ts` | Deny |
| 6 | `Glob`, pattern `**/*.md` | Allow |
| 7 | `Read`, file path ending `.ts` | Deny, reason contains "list_symbols" |
| 8 | `Read`, file path ending `.md` | Allow |
| 9 | `Read` on `.ts`, `block_reads=false` in routing config | Allow |
| 10 | `Read` on `.ts` file outside `workspace_root` | Allow |

### `test-worktree-write-guard.sh` (4 tests)

| # | Setup | Expected |
|---|-------|----------|
| 1 | Non-write tool (`list_symbols`) | Allow |
| 2 | Write tool, CWD in main repo (not worktree) | Allow |
| 3 | Write tool, CWD in worktree, no marker | Allow |
| 4 | Write tool, CWD in worktree, marker exists | Deny, reason contains "activate_project" |

### `test-worktree-activate.sh` (4 tests)

| # | Tool + Setup | Expected |
|---|-------------|----------|
| 1 | Non-`EnterWorktree` tool | Silent exit |
| 2 | `EnterWorktree`, no CE configured | Silent exit |
| 3 | `EnterWorktree`, `worktree_path` in response | Marker created, context contains "activate_project", symlink at `<wt>/.code-explorer` |
| 4 | `EnterWorktree`, no `worktree_path` in response | Fallback: finds most-recent worktree, same outputs |

### `test-ce-activate-project.sh` (3 tests)

| # | Setup | Expected |
|---|-------|----------|
| 1 | Non-`activate_project` tool | Silent exit |
| 2 | `activate_project`, no marker at path | Silent exit |
| 3 | `activate_project`, marker present | Marker deleted, context contains "✓ CE switched" |

### `test-subagent-guidance.sh` (4 tests)

| # | Agent type + Setup | Expected |
|---|-------------------|----------|
| 1 | `Bash` agent | Silent exit |
| 2 | `statusline-setup` agent | Silent exit |
| 3 | Coding agent, no CE configured | Silent exit |
| 4 | Coding agent, CE present, system prompt present | Context contains CE directive + system prompt content |

**Total: 33 tests**

## `run-all.sh` Behavior

- Sources `lib/fixtures.sh` once (initializes counters)
- Runs each test script in sequence via `source`
- Prints per-test PASS/FAIL as they run
- Prints summary: `Results: 33 passed, 0 failed`
- Exits 0 if all pass, exits 1 if any failed

## Usage

```bash
./tests/run-all.sh
```

Add to version bump checklist (CLAUDE.md) as a gate before bumping.

## What Is Not Tested

- Live Claude Code session behavior (hook output actually reaching Claude) — requires
  a real Claude Code session; covered by manual smoke testing
- MCP server connectivity (hooks detect config, not live connection)
- Background index subprocess (spawned with `&`; test verifies the message is emitted)
