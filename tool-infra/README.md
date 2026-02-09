# tool-infra

Infrastructure hooks for Serena and IntelliJ MCP tools.

## What it does

**serena-activate-guard** -- Ensures the Serena project is activated before any Serena tool call. Denies with activation instructions if not yet activated. Uses a temp marker file so the check is near-instant (~0.1ms) after first activation.

**intellij-project-path** -- Auto-injects `project_path` into IntelliJ index tool calls when missing, using `cwd` from the hook input. Prevents "project_path required" errors.

## Installation

```
/plugin marketplace add mareurs/claude-plugins
/plugin install tool-infra@claude-plugins
```

## How it works

Both hooks trigger on `PreToolUse`:

| Hook | Matcher | Action |
|------|---------|--------|
| serena-activate-guard | `mcp__.*serena.*` | Deny until `activate_project()` called |
| intellij-project-path | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

The Serena guard derives the project name from `basename` of `cwd` -- no per-project configuration needed.

## Requirements

- `jq` (for JSON parsing in hook scripts)

## License

MIT
