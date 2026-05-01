# codescout-companion

Companion plugin for [codescout](https://github.com/mareurs/codescout) MCP server.

Routes Claude Code agents to use codescout's symbol-aware tools instead of
falling back to Read/Grep/Glob on source files. Auto-detects codescout from
`.mcp.json`, `~/.claude/.claude.json`, or `~/.claude/settings.json`.

## Quick Install

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install codescout-companion@sdd-misc-plugins
```

Start a new Claude Code session — the plugin activates automatically.

## Requirements

- [codescout](https://github.com/mareurs/codescout) MCP server configured locally or globally
- `jq` installed (used for JSON parsing in hooks)
- `sqlite3` installed (for staleness checks and drift queries)
- `git` installed (for HEAD comparison and worktree detection)

## What It Does

- **System prompt injection** — Injects an active tool-use directive into all coding subagents (SubagentStart hook); appends `.code-explorer/system-prompt.md` when present. Also injects memory hints, drift warnings, and onboarding nudge into the main agent (SessionStart hook).
- **Tool routing** — Warns when Read/Grep/Glob are used on source files, suggests `symbols`, `search_pattern` etc. (PostToolUse hook). Generic tool routing is already covered by codescout's MCP `server_instructions`.
- **Auto-reindex** — Checks index staleness at session start, triggers `codescout index` in background if behind HEAD
- **Drift warnings** — Surfaces high-drift files and flags stale docs/memories
- **Worktree guard** — Blocks codescout write tools until `workspace` is called after `EnterWorktree`

## Full Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install codescout-companion@sdd-misc-plugins
```

Or add to project `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "codescout-companion@sdd-misc-plugins": true
  }
}
```

## Configuration

### Auto-detection

The plugin auto-detects codescout by scanning (in order):

1. `.claude/codescout-companion.json` (or `.claude/codescout-routing.json` / `.claude/code-explorer-routing.json` for backwards compatibility) — explicit config override
2. `.mcp.json` — project-level MCP config
3. `~/.claude/.claude.json` — servers added via `claude mcp add`
4. `~/.claude/settings.json` — manually configured servers

Detection matches any server whose `command` or `args` contain `codescout` or `code-explorer`.

### Config file

Create `.claude/codescout-companion.json` (or `codescout-routing.json`) in your project for fine-grained control:

```json
{
  "server_name": "codescout",
  "workspace_root": "~/work",
  "block_reads": true,
  "auto_index": true,
  "drift_warnings": true
}
```

| Field | Default | Description |
|---|---|---|
| `server_name` | auto-detected | Override codescout server name |
| `workspace_root` | (none) | Only block tools for files under this path |
| `block_reads` | `true` | Warn on Read/Grep/Glob for source files (PostToolUse) |
| `auto_index` | `true` | Check staleness and reindex at session start |
| `drift_warnings` | `true` | Surface drift warnings in session context |

## Hooks

| Event | Hook | Purpose |
|---|---|---|
| `SessionStart` | `session-start.sh` | Tool guide + memory hints + onboarding nudge |
| `SubagentStart` | `subagent-guidance.sh` | Compact guidance for all subagents |
| `PreToolUse` (Grep/Glob/Read/Bash) | `pre-tool-guard.sh` | Hard-block Read/Grep/Glob/sed-i on source files, redirect to codescout |
| `PostToolUse` (EnterWorktree) | `worktree-activate.sh` | Symlink .code-explorer/ and inject workspace guidance |

## Ollama Setup

Semantic search (`semantic_search`, `index`) requires an embedding backend.
The recommended option is Ollama — fully local, no API key required.

**Using the install script** (from the codescout repo root):

```bash
./scripts/install-ollama.sh --check     # verify current state
./scripts/install-ollama.sh --install   # install ollama + pull nomic-embed-text
```

**Manually** (if you already have Ollama):

```bash
ollama pull nomic-embed-text
```

Then add to `.codescout/project.toml` in your project:

```toml
[embeddings]
model = "ollama:nomic-embed-text"
```

Build the index once in a Claude Code session:

```
Run index
```

→ [Embedding backends reference](https://github.com/mareurs/codescout/blob/master/docs/manual/src/configuration/embedding-backends.md)

## Troubleshooting

### "codescout not detected"

The plugin scans these locations for a codescout server entry (in order):

1. `.claude/codescout-companion.json` (or `.claude/codescout-routing.json` for backwards compat)
2. `.mcp.json` in the project root
3. `~/.claude/.claude.json`
4. `~/.claude/settings.json`

It matches any server whose `command` or `args` contain `codescout` or `code-explorer`.

If auto-detection fails, force it with `.claude/codescout-companion.json`:

```json
{ "server_name": "codescout" }
```

### Tools not routing to codescout

Verify the plugin is enabled:

```bash
claude /plugin list
# should show: codescout-companion@sdd-misc-plugins
```

Check that `block_reads` is not set to `false` in `.claude/codescout-companion.json`.

### LSP errors on first use (`symbols`, `symbol_at` fail)

LSP servers start during `onboarding`. If you skipped it, run:

```
Run onboarding
```

This detects languages, starts LSP servers, and writes project memories. Without it,
symbol navigation tools return errors because no LSP server is running.

### `semantic_search` returns nothing or errors

The embedding index has not been built yet. Run:

```
Run index
```

For a ~100k line project this takes 1–3 minutes. Verify status with `workspace`.

If `index` fails, confirm Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

### MCP server fails to start (tools missing from Claude Code)

```bash
which codescout        # verify the binary is on PATH
codescout --version    # verify it runs
claude mcp list        # verify it is registered
```

If `codescout` is not on PATH, install it (`cargo install codescout`) or add
`~/.cargo/bin` to your PATH.

### SubagentStart hook not firing

After updating Claude Code, plugins sometimes need to be re-enabled:

```bash
claude /plugin list
```

If `codescout-companion@sdd-misc-plugins` is absent, reinstall:

```
/plugin install codescout-companion@sdd-misc-plugins
```

## Coupling to codescout

This plugin is **intentionally tightly coupled** to codescout. It reads
codescout's SQLite DB, calls its CLI binary, and references its internal
schema. It should be updated whenever codescout adds features that affect
exploration workflows.

## Changelog

### 1.5.3

- **Feature:** `SubagentStart` hook now always injects an active tool-use directive into coding subagents, even when no `.code-explorer/system-prompt.md` exists. Previously the hook silently exited when the system prompt was absent, leaving subagents (code-reviewer, design agents, etc.) with no guidance to prefer code-explorer tools over Read/Grep/Glob/Bash.

### 1.5.2

- **Fix:** Improved detection of false positives in Bash read-tool detection
- **Fix:** Block Bash grep/cat/head/tail on source files

### 1.5.1

- **Fix:** Expand Bash guard to block `grep`/`cat`/`head`/`tail` on source files — agents were bypassing Read/Grep guards by routing through Bash
- **Fix:** Session-start connectivity note no longer says "fall back to Read/Grep/Glob" (those are now hard-blocked); clarifies ToolSearch is not needed

### 1.5.0

- **Switch:** PostToolUse soft warnings → PreToolUse hard blocks for Read/Grep/Glob/Bash(sed -i) on source files — soft warnings were ignored because tool output was already in context
- **Rename:** `post-tool-guidance.sh` → `pre-tool-guard.sh`
- **Update:** Block messages now say "BLOCKED" instead of "deprecated, will be blocked"

### 1.4.1

- **Fix:** Add `git worktree prune` guidance to write guard block message — prevents agent looping when worktree directory is already deleted
- **Update:** Plugin description and README to reflect actual behavior (system-prompt.md injection, not tool guidance injection)

### 1.4.0

- **Add:** Inject `.code-explorer/system-prompt.md` verbatim into SessionStart and SubagentStart — project-specific guidance generated by `onboarding()`, reaches all agents
- **Remove:** `guidance.txt` — confirmed redundant; MCP `server_instructions` are re-sent per subagent's fresh session, generic tool routing is already covered
- **Simplify:** `subagent-guidance.sh` now exits silently when no `system-prompt.md` exists
- **Requires:** codescout >= fb302f4 for `system-prompt.md` generation at onboarding

### 1.3.1

- **Fix:** Use mtime to find newest worktree in fallback
- **Fix:** Normalize path in `ce-activate-project`, add escape hatch to guard

### 1.3.0

- **Add:** Worktree write guard — hard-blocks MCP write tools until `workspace` is called after `EnterWorktree`

### 1.2.1

- **Fix:** Remove ToolSearch references from guidance — MCP tools auto-load, no manual step needed
- **Add:** Graceful degradation — fallback note when MCP server fails to connect
- **Add:** Connectivity caveat in SessionStart output (hooks can't verify MCP handshake)
- **Add:** Auto-reindex at session start (background, non-blocking)
- **Add:** Drift warnings for significantly changed files
- **Fix:** Sync guidance.txt with server_instructions.md
- **Fix:** Clean up README to match actual hook behavior

### 1.1.0

- **Switch:** PreToolUse hard-blocking → PostToolUse soft-blocking for Read/Grep/Glob on source files
- **Remove:** `semantic-tool-router.sh` (replaced by `post-tool-guidance.sh`)
- **Add:** `worktree-activate.sh` PostToolUse hook for git worktree support
- **Update:** Tool name references to match codescout API rename (`symbols`, `search_pattern`, `references`, `replace_symbol`, etc.)
- **Fix:** Detect codescout from `~/.claude/.claude.json` (where `claude mcp add` writes), not just `settings.json`
- **Strengthen:** `read_file` marked as LAST RESORT in all guidance
- **Add:** Auto-index + drift warnings design doc (`docs/plans/`)
- **Add:** Companion plugin documentation in CLAUDE.md

### 0.1.1

- Single-source guidance via `guidance.txt`
- Workspace scoping for PreToolUse blocking

### 0.1.0

- Initial release: SessionStart, SubagentStart, PreToolUse hooks
- Auto-detection from `.mcp.json` and global settings
