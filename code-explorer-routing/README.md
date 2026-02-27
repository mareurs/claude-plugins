# code-explorer-routing

Companion plugin for [code-explorer](https://github.com/mareurs/code-explorer) MCP server.

Routes Claude Code agents to use code-explorer's symbol-aware tools instead of
falling back to Read/Grep/Glob on source files. Auto-detects code-explorer from
`.mcp.json`, `~/.claude/.claude.json`, or `~/.claude/settings.json`.

## What It Does

- **Tool guidance** — Injects tool selection rules into all agents and subagents (SessionStart + SubagentStart hooks)
- **Tool routing** — Warns when Read/Grep/Glob are used on source files, redirects to `list_symbols`, `find_symbol`, `search_pattern` etc. (PostToolUse hook)
- **ToolSearch bootstrap** — Guides agents to load deferred MCP tools via `ToolSearch` before exploring code
- **Auto-reindex** *(planned)* — Checks index staleness at session start, triggers `code-explorer index` if behind HEAD
- **Drift warnings** *(planned)* — Surfaces high-drift files and flags stale docs/memories

## Requirements

- [code-explorer](https://github.com/mareurs/code-explorer) MCP server configured locally or globally
- `jq` installed (used for JSON parsing in hooks)
- `sqlite3` installed (for staleness checks and drift queries — planned)
- `git` installed (for HEAD comparison — planned)

## Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install code-explorer-routing@sdd-misc-plugins
```

Or add to project `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "code-explorer-routing@sdd-misc-plugins": true
  }
}
```

## Configuration

### Auto-detection

The plugin auto-detects code-explorer by scanning (in order):

1. `.claude/code-explorer-routing.json` — explicit config override
2. `.mcp.json` — project-level MCP config
3. `~/.claude/.claude.json` — servers added via `claude mcp add`
4. `~/.claude/settings.json` — manually configured servers

Detection matches any server whose `command` or `args` contain `code-explorer`.

### Config file

Create `.claude/code-explorer-routing.json` in your project for fine-grained control:

```json
{
  "server_name": "code-explorer",
  "workspace_root": "~/work",
  "block_reads": true,
  "auto_index": true,
  "drift_warnings": true
}
```

| Field | Default | Description |
|---|---|---|
| `server_name` | auto-detected | Override code-explorer server name |
| `workspace_root` | (none) | Only block tools for files under this path |
| `block_reads` | `true` | Block Read/Grep/Glob on source files |
| `auto_index` | `true` | Check staleness and reindex at session start *(planned)* |
| `drift_warnings` | `true` | Surface drift warnings in session context *(planned)* |

## Hooks

| Event | Hook | Purpose |
|---|---|---|
| `SessionStart` | `session-start.sh` | Tool guide + memory hints + onboarding nudge |
| `SubagentStart` | `subagent-guidance.sh` | Compact guidance for all subagents |
| `PostToolUse` (Grep/Glob/Read) | `post-tool-guidance.sh` | Warn and redirect to code-explorer for source files |
| `PostToolUse` (EnterWorktree) | `worktree-activate.sh` | Symlink .code-explorer/ and inject activate_project guidance |

## Coupling to code-explorer

This plugin is **intentionally tightly coupled** to code-explorer. It reads
code-explorer's SQLite DB, calls its CLI binary, and references its internal
schema. It should be updated whenever code-explorer adds features that affect
exploration workflows.

## Changelog

### 1.2.0

- **Switch:** PreToolUse hard-blocking → PostToolUse soft-blocking for Read/Grep/Glob on source files
- **Remove:** `semantic-tool-router.sh` (replaced by `post-tool-guidance.sh`)
- **Add:** `worktree-activate.sh` PostToolUse hook for git worktree support
- **Update:** Tool name references to match code-explorer API rename (`list_symbols`, `search_pattern`, `find_references`, `replace_symbol`, etc.)

### 1.1.0

- **Fix:** Detect code-explorer from `~/.claude/.claude.json` (where `claude mcp add` writes), not just `settings.json`
- **Strengthen:** `read_file` marked as LAST RESORT in all guidance
- **Strengthen:** ToolSearch bootstrap instructions added to guidance (deferred MCP tools need loading)
- **Strengthen:** PreToolUse deny messages include last-resort hierarchy
- **Add:** Auto-index + drift warnings design doc (`docs/plans/`)
- **Add:** Companion plugin documentation in CLAUDE.md

### 0.1.1

- Single-source guidance via `guidance.txt`
- Workspace scoping for PreToolUse blocking

### 0.1.0

- Initial release: SessionStart, SubagentStart, PreToolUse hooks
- Auto-detection from `.mcp.json` and global settings
