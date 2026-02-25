# code-explorer-routing

Semantic tool routing plugin for [code-explorer](https://github.com/mareurs/code-explorer) MCP server.

Injects code-explorer tool guidance into all Claude Code agents and subagents, and redirects Grep/Glob/Read on source files to code-explorer's symbol-aware equivalents.

## What It Does

- **SessionStart hook** — injects tool selection decision tree, progressive disclosure rules, and memory hints into the main agent
- **SubagentStart hook** — injects compact guidance into all subagents (rich reference for Plan agents)
- **PreToolUse hook** — blocks Grep/Glob/Read on source files and redirects to appropriate code-explorer tools

## Requirements

- code-explorer MCP server configured in `.mcp.json` or globally
- `jq` installed (used for JSON parsing in hooks)

## Installation

```
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

The plugin auto-detects code-explorer by scanning `.mcp.json` for any server whose command or args contain `code-explorer`.

### Global MCP server override

If code-explorer is configured globally (not in `.mcp.json`), create `.claude/code-explorer-routing.json` in your project:

```json
{ "server_name": "code-explorer" }
```

Replace `"code-explorer"` with whatever key you used when registering the global MCP server.

## Hooks

| Event | Hook | Purpose |
|---|---|---|
| `SessionStart` | `session-start.sh` | Main agent tool guide + memory hints |
| `SubagentStart` | `subagent-guidance.sh` | Subagent guidance (agent-type-aware) |
| `PreToolUse` (Grep/Glob/Read) | `semantic-tool-router.sh` | Redirect to code-explorer for source files |
