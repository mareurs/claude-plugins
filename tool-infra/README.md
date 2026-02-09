# tool-infra

Infrastructure hooks for IntelliJ MCP tools.

## What it does

**intellij-project-path** (PreToolUse) -- Auto-injects `project_path` into IntelliJ index tool calls when missing, using `cwd` from the hook input. Prevents "project_path required" errors.

## Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install tool-infra@sdd-misc-plugins
```

## How it works

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

## Requirements

- `jq` (for JSON parsing in hook scripts)
- [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp)

## License

MIT
