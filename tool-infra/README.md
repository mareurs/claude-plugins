# tool-infra

Infrastructure hooks for Serena and IntelliJ MCP tools.

## What it does

### Serena hooks (two-layer approach)

**serena-session-start** (SessionStart) -- At conversation start, checks if `.serena/project.yml` exists and instructs Claude to: check onboarding, onboard if needed, then activate the project. This is the primary activation mechanism.

**serena-activate-guard** (PreToolUse, safety net) -- Denies Serena tool calls if activation hasn't happened yet. Fallback in case Claude skips or hasn't completed the session start instructions. Includes the activation steps in the deny message so Claude can self-correct.

### IntelliJ hook

**intellij-project-path** (PreToolUse) -- Auto-injects `project_path` into IntelliJ index tool calls when missing, using `cwd` from the hook input. Prevents "project_path required" errors.

## Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install tool-infra@sdd-misc-plugins
```

## How it works

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| serena-session-start | SessionStart | all | Instruct Claude to onboard + activate Serena |
| serena-activate-guard | PreToolUse | `mcp__.*serena.*` | Deny with activation instructions if not yet activated |
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

The Serena hooks derive the project name from `basename` of `cwd` -- no per-project configuration needed. The session start hook only fires if `.serena/project.yml` exists in the project.

## Requirements

- `jq` (for JSON parsing in hook scripts)
- [Serena MCP](https://github.com/oraios/serena) for Serena hooks
- [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp) for IntelliJ hook

## License

MIT
