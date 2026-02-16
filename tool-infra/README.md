# tool-infra

Infrastructure hooks that make Claude use semantic code tools (Serena, IntelliJ MCP, claude-context) instead of text search.

## The Problem

Claude defaults to Grep, Glob, and Read for code navigation. These work but miss the semantic understanding that tools like Serena, IntelliJ, and claude-context provide -- symbol relationships, type hierarchies, cross-references, and meaning-based search. This plugin intercepts text-search and whole-file-read calls on source files and redirects Claude to the right semantic tool.

## What it does

### session-start (SessionStart)
Prints a reference card of available semantic tools at conversation start. Adapts content based on which tools are detected.

When **Serena** is available:
- Points Claude to Serena project memories for understanding the codebase (instead of repeated list_dir calls)
- Recommends bash ls for directory browsing (faster, richer than Serena's list_dir)
- Injects **exploration workflow** directly into the main agent: `get_symbols_overview` -> `find_symbol(include_body=true)` -> `find_referencing_symbols`
- Reactive fallbacks for "No active project" and "not onboarded" edge cases

When **claude-context** is available, includes good/bad query examples:
- Good: `search_code("how are API errors handled and returned to clients")`
- Bad: `search_code("class DatabasePool")` -- use find_symbol instead

Only lists tools that are actually available in the project.

### semantic-tool-router (PreToolUse)
Intercepts Grep, Glob, and Read calls targeting source files and denies them with specific semantic tool suggestions.

**Language-aware filtering**: Reads `.serena/project.yml` to detect project languages and only intercepts matching file extensions. Falls back to a broad pattern when no Serena config exists.

**Blocked** (with suggestions):
- `Grep` on source files (by extension or `type` parameter)
- `Glob` looking for specific class files (e.g. `**/TeacherService.kt`)
- `Read` on source files **without** explicit `limit` or `offset` (whole-file reads)

**Allowed**:
- `Grep` on non-source files (`.md`, `.json`, `.yml`, `.toml`, etc.)
- `Glob` with broad patterns (`**/*.kt`, `*Test.kt`)
- `Read` with explicit `limit` or `offset` (targeted/intentional reads)
- `Read` on non-source files
- Everything, if no semantic tools are available in the project

**Escape hatch**: To read an entire source file intentionally, set `limit` explicitly (e.g. `limit: 2000`).

### mcp-param-fixer (PreToolUse)
Auto-corrects wrong MCP parameter names in-place so the call succeeds on the first attempt (no wasted retry turn). Currently catches:

| Tool | Wrong param | Corrected to |
|------|------------|-------------|
| `search_for_pattern` | `pattern` | `substring_pattern` |
| `edit_memory` | `old_string` | `needle` |
| `edit_memory` | `new_string` | `repl` |
| `ide_find_references` | `query` | `file` |

### explore-agent-guidance (SubagentStart)
Injects a semantic tool workflow into Explore subagents:
1. Semantic discovery (search_code) -- with inline query examples when claude-context is available
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

Hooks read `.mcp.json` and `.serena/project.yml` in the project root to detect which MCP servers and languages are available. No configuration needed if your MCP servers are defined per-project.

### Override for global MCP servers

If your MCP servers are defined globally (in `~/.claude/settings.json` or similar), auto-detection won't find them. Create `.claude/tool-infra.json` in the project root:

```json
{
  "serena": true,
  "intellij": true,
  "claude-context": true
}
```

- `true` -- force-enable (skips `.mcp.json` check)
- `false` or omitted -- fall back to auto-detection

### Detection priority

1. `.claude/tool-infra.json` overrides (checked first)
2. `.mcp.json` auto-detection (fallback)
3. `.serena/project.yml` for language-aware extension filtering

## Hook Reference

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| session-start | SessionStart | all | Tool reference card + exploration workflow + memory references |
| semantic-tool-router | PreToolUse | `Grep\|Glob\|Read` | Deny with semantic tool suggestions (language-aware) |
| mcp-param-fixer | PreToolUse | `mcp__.*` | Auto-correct wrong parameter names in-place |
| explore-agent-guidance | SubagentStart | `Explore` | Inject semantic exploration workflow |
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |

## Requirements

- `jq` (for JSON parsing in hook scripts)
- At least one semantic code tool:
  - [Serena MCP](https://github.com/oraios/serena) -- symbolic code intelligence via LSP
  - [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp) -- IDE-powered code intelligence
  - [claude-context](https://github.com/nicobailon/claude-context) -- semantic vector search

Without any semantic tools, the routing hooks are no-ops (nothing is blocked).

## License

MIT
