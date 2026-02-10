# tool-infra

Infrastructure hooks that make Claude use semantic code tools (Serena, IntelliJ MCP) instead of text search.

## The Problem

Claude defaults to Grep and Glob for code navigation. These work but miss the semantic understanding that tools like Serena and IntelliJ provide -- symbol relationships, type hierarchies, cross-references. This plugin intercepts text-search calls on source files and redirects Claude to the right semantic tool.

## What it does

### session-start (SessionStart)
Prints a reference card of available semantic tools at conversation start. Pre-loads MCP tool schemas via ToolSearch to prevent parameter name guessing errors (e.g. Claude using `pattern` instead of `substring_pattern`).

Only lists tools that are actually available in the project.

### semantic-tool-router (PreToolUse)
Intercepts Grep and Glob calls targeting source files and denies them with specific semantic tool suggestions.

**Blocked** (with suggestions):
- `Grep` on `.kt`, `.java`, `.ts`, `.py`, `.go`, `.rs`, `.cs`, `.rb`, `.scala`, `.swift`, `.cpp`, `.c` files
- `Glob` looking for specific class files (e.g. `**/TeacherService.kt`)

**Allowed**:
- `Grep` on non-source files (`.md`, `.json`, `.yml`, `.toml`, etc.)
- `Glob` with broad patterns (`**/*.kt`, `*Test.kt`)
- Everything, if no semantic tools are available in the project

### mcp-param-fixer (PreToolUse)
Denies MCP calls with wrong parameter names and tells Claude the correct name, so it retries correctly. Currently catches:

| Tool | Wrong param | Corrected to |
|------|------------|-------------|
| `search_for_pattern` | `pattern` | `substring_pattern` |
| `edit_memory` | `old_string` | `needle` |
| `edit_memory` | `new_string` | `repl` |

### explore-agent-guidance (SubagentStart)
Injects a semantic tool workflow into Explore subagents:
1. Semantic discovery (search_code, search_for_pattern)
2. Symbol drill-down (find_symbol)
3. Cross-reference (find_referencing_symbols)

### intellij-project-path (PreToolUse)
Auto-injects `project_path` into IntelliJ index tool calls when missing, using `cwd` from the hook input. Prevents "project_path required" errors.

## Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install tool-infra@sdd-misc-plugins
```

## Configuration

### Auto-detection (default)

Hooks read `.mcp.json` in the project root to detect which MCP servers are available. No configuration needed if your MCP servers are defined per-project.

### Override for global MCP servers

If your MCP servers are defined globally (in `~/.claude/settings.json` or similar), auto-detection won't find them. Create `.claude/tool-infra.json` in the project root:

```json
{
  "serena": true,
  "intellij": true,
  "claude-context": false
}
```

- `true` -- force-enable (skips `.mcp.json` check)
- `false` or omitted -- fall back to auto-detection

### Detection priority

1. `.claude/tool-infra.json` overrides (checked first)
2. `.mcp.json` auto-detection (fallback)

## Hook Reference

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| session-start | SessionStart | all | Tool reference card + schema pre-loading |
| semantic-tool-router | PreToolUse | `Grep\|Glob` | Deny with semantic tool suggestions |
| mcp-param-fixer | PreToolUse | `mcp__.*` | Auto-correct wrong parameter names |
| explore-agent-guidance | SubagentStart | `Explore` | Inject semantic exploration workflow |
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

## Requirements

- `jq` (for JSON parsing in hook scripts)
- At least one semantic code tool:
  - [Serena MCP](https://github.com/oraios/serena) -- symbolic code intelligence via LSP
  - [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp) -- IDE-powered code intelligence

Without any semantic tools, the routing hooks are no-ops (nothing is blocked).

## License

MIT
