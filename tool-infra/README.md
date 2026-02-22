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

When **both Serena and IntelliJ** are available (dual-tool mode):
- Shows task-aware decision matrix: Serena for reading/editing, IntelliJ for cross-file navigation
- Annotates tool preferences based on measured performance (e.g. `get_symbols_overview` 3x cheaper than `ide_file_structure`, `find_symbol` gives full body vs `ide_find_definition` 4-line preview)
- Lists **known issues** to steer away from broken tools (`ide_call_hierarchy` callers, `ide_search_text` pollution, language-specific Serena limitations)
- Includes workflow patterns (Understand Before Editing, Find Usages Before Refactoring, Explore Unfamiliar Code)
- Explains the bridge pattern for Kotlin/Java: `ide_find_symbol(query)` → `ide_find_references(file, line, col)`

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
Auto-corrects wrong MCP parameter names and value types in-place so the call succeeds on the first attempt (no wasted retry turn). All applicable corrections are applied before output (supports multiple fixes per call).

**Parameter name corrections:**

| Tool | Wrong param | Corrected to |
|------|------------|-------------|
| `search_for_pattern` | `pattern` | `substring_pattern` |
| `find_symbol` | `name_path` | `name_path_pattern` |
| `edit_memory` | `old_string` | `needle` |
| `edit_memory` | `new_string` | `repl` |
| `ide_find_references` | `query` | `file` |

**Value type coercions:**

| Tool | Param | Fix |
|------|-------|-----|
| `find_symbol` | `include_body` | string `"true"`/`"false"` → boolean |

### subagent-guidance (SubagentStart)
Injects a semantic tool workflow into **all** code-working subagents (Explore, Plan, general-purpose, code-reviewer, etc.). Skips non-code agents (Bash, statusline-setup, claude-code-guide).

**Plan agents** receive enriched guidance: full tool reference tables, workflow patterns (understand-edit, find-usages-refactor, explore-unfamiliar), and "PLAN AROUND THESE" known issues -- so implementation plans route to the right tools and avoid broken ones.

Other subagents get a compact version with the same layered DISCOVER → STRUCTURE → READ → NAVIGATE workflow, plus explicit guidance to never use Read on entire source files. This is critical because PreToolUse hooks (like semantic-tool-router) do not fire inside subagents.

### intellij-project-path (PreToolUse)
Auto-injects `project_path` into IntelliJ index tool calls when missing, using `cwd` from the hook input. Prevents "project_path required" errors.

### dual-tool-router (PreToolUse)
Language-aware blocking of known-broken Serena calls when IntelliJ is available (dual-tool mode). Redirects to working IntelliJ equivalents with bridge pattern hints.

**Auto-detection**: Reads project languages from `.serena/project.yml`. Serena cross-file references work for Python, TypeScript, Bash, Go, Rust, Ruby -- but are broken for Kotlin and Java (community LSP limitations). The router auto-enables/disables based on detected languages.

**Blocked** (when language has broken Serena cross-file ops):
- `find_referencing_symbols` → bridge: `ide_find_symbol(query)` → `ide_find_references(file, line, col)`
- `rename_symbol` → bridge: `ide_find_symbol(query)` → `ide_refactor_rename(file, line, col, newName)`

Deny messages explain the root cause, show the two-step bridge, and note that Serena single-file operations (`get_symbols_overview`, `find_symbol`, `replace_symbol_body`) still work fine for all languages.

**Override**: Auto-detection can be overridden in `.claude/tool-infra.json`:
```json
{
  "serena_references_works": true,
  "serena_rename_works": true
}
```
Set to `true`/`false` to force. Omit or set to `"auto"` for language-based auto-detection.

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
  "claude-context": true,
  "serena_references_works": true,
  "serena_rename_works": true
}
```

- `true` -- force-enable (skips `.mcp.json` check)
- `false` or omitted -- fall back to auto-detection
- `serena_references_works` -- override auto-detection for Serena's `find_referencing_symbols` (default: auto-detected from project languages)
- `serena_rename_works` -- override auto-detection for Serena's `rename_symbol` (default: auto-detected from project languages)

### Detection priority

1. `.claude/tool-infra.json` overrides (checked first for tool presence)
2. `.mcp.json` auto-detection (fallback for tool presence)
3. `.serena/project.yml` for:
   - Language-aware source file extension filtering (used by semantic-tool-router)
   - Language-aware capability flags (used by dual-tool-router): Python/TypeScript/Bash → refs work, Kotlin/Java → refs broken
4. `.claude/tool-infra.json` capability flag overrides (takes precedence over language auto-detection)

## Hook Reference

| Hook | Event | Matcher | Action |
|------|-------|---------|--------|
| session-start | SessionStart | all | Tool reference card + known issues + exploration workflow + memory references |
| subagent-guidance | SubagentStart | all (skips Bash, statusline-setup, claude-code-guide) | Compact workflow for subagents; enriched guidance with workflow patterns + known issues for Plan agents |
| semantic-tool-router | PreToolUse | `Grep\|Glob\|Read` | Deny with semantic tool suggestions (language-aware) |
| mcp-param-fixer | PreToolUse | `mcp__.*` | Auto-correct wrong parameter names in-place |
| intellij-project-path | PreToolUse | `mcp__intellij-index__.*` | Inject `project_path` from `cwd` |
| dual-tool-router | PreToolUse | `mcp__serena__find_referencing_symbols\|mcp__serena__rename_symbol` | Language-aware blocking of broken Serena calls, redirect to IntelliJ (dual mode only) |

## Requirements

- `jq` (for JSON parsing in hook scripts)
- At least one semantic code tool:
  - [Serena MCP](https://github.com/oraios/serena) -- symbolic code intelligence via LSP
  - [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp) -- IDE-powered code intelligence
  - [claude-context](https://github.com/nicobailon/claude-context) -- semantic vector search

Without any semantic tools, the routing hooks are no-ops (nothing is blocked).

## License

MIT
