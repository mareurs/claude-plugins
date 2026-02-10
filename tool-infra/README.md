# tool-infra

Infrastructure hooks for projects with semantic code tools (Serena, IntelliJ MCP, etc.).

## What it does

### session-start (SessionStart)
Prints a semantic tools reference card and instructs Claude to pre-load MCP tool schemas via ToolSearch. Prevents parameter name guessing errors.

### semantic-tool-router (PreToolUse)
Blocks Grep/Glob on source files and redirects to semantic tools. Supports Kotlin, Java, TypeScript, Python, Go, Rust, C#, Ruby, Scala, Swift, C/C++. Allows broad directory scans (`**/*.kt`) but blocks specific class lookups (`**/TeacherService.kt`).

### mcp-param-fixer (PreToolUse)
Auto-corrects common MCP parameter name mistakes (e.g. `pattern` -> `substring_pattern` for Serena's search_for_pattern). Safety net for when Claude guesses wrong param names.

### explore-agent-guidance (SubagentStart)
Injects a semantic tool workflow into Explore subagents: semantic discovery -> symbol drill-down -> cross-reference.

### intellij-project-path (PreToolUse)
Auto-injects `project_path` into IntelliJ index tool calls when missing.

## Installation

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install tool-infra@sdd-misc-plugins
```

## How it works

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| session-start | SessionStart | all | Tool reference card + schema pre-loading |
| semantic-tool-router | PreToolUse | `Grep\|Glob` | Deny with semantic tool suggestions |
| mcp-param-fixer | PreToolUse | `mcp__.*` | Auto-correct wrong parameter names |
| explore-agent-guidance | SubagentStart | `Explore` | Inject semantic exploration workflow |
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

## Configuration

Hooks auto-detect available MCP servers from `.mcp.json`. For servers defined globally (not per-project), create `.claude/tool-infra.json`:

```json
{
  "serena": true,
  "intellij": true,
  "claude-context": false
}
```

Set a key to `true` to force-enable that tool (skips `.mcp.json` check). Omitted or `false` keys fall back to auto-detection.

## Requirements

- `jq` (for JSON parsing in hook scripts)
- Semantic code tools: [Serena MCP](https://github.com/oraios/serena) and/or [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp)

## License

MIT
