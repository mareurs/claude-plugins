# Plugin Refactor Design

**Date**: 2026-02-26
**Status**: Approved

## Problems

1. **Editing guidance missing** — LLM picks `replace_content` for code instead of
   `edit_lines` or symbol tools. No hook or guidance steers editing choices.
2. **Blocking scope too broad** — PreToolUse hook blocks source file reads outside
   the workspace where code-explorer can't help (e.g. reading `.sh` in a sibling repo).
3. **Block fatigue** — Generic block messages don't tell Claude what to do next.
   Repeated blocks make Claude give up instead of trying the right tool.
4. **Guidance staleness** — Tool guide is duplicated in 3 places (session-start,
   subagent Plan, subagent compact). Every code-explorer tool change requires
   updating all 3.

## Solution

### 1. Single-source guidance (~20 lines)

Replace the ~80 line duplicated guide with a single `guidance.txt` file read by
both `session-start.sh` and `subagent-guidance.sh`:

```
CODE-EXPLORER: Read -> Navigate -> Edit. Never skip steps.

READ code:
  get_symbols_overview(file)  -> see structure + line numbers
  find_symbol(name, include_body=true) -> read one symbol
  NEVER read_file without start_line + end_line from a prior overview.

FIND code:
  Know the name  -> find_symbol(pattern)
  Know a concept -> semantic_search("query")
  Need callers   -> find_referencing_symbols(name_path, file)
  Need regex     -> search_for_pattern(pattern)

EDIT code:
  Symbol-level (preferred) -> replace_symbol_body / insert_before_symbol / insert_after_symbol
  Line-level (know lines)  -> edit_lines(path, start_line, delete_count, new_text)
  Text find-replace (non-code only) -> replace_content(path, old, new)

RULES:
  1. Structure before content -- get_symbols_overview ALWAYS before reading
  2. Symbol tools for code edits -- never replace_content on source files
  3. Grep/Glob/Read are for .md .json .toml .yaml only -- code-explorer for source
```

No more Plan vs compact split. Everyone gets the same 20 lines. Session-start
prepends onboarding/memory preamble when applicable.

### 2. Workspace-scoped blocking

Config in `.claude/code-explorer-routing.json`:
```json
{
  "server_name": "code-explorer",
  "workspace_root": "~/work",
  "block_reads": true
}
```

Before blocking, `semantic-tool-router.sh` resolves the target path and checks
if it's under `workspace_root`. Files outside the workspace pass through.
`block_reads: false` disables all blocking.

`detect-tools.sh` reads and exports `WORKSPACE_ROOT` and `BLOCK_READS`.

### 3. Specific redirect messages

Block messages include the actual path/pattern from the blocked call:

| Blocked call | Redirect |
|---|---|
| `Read("src/tools/file.rs")` | `Use get_symbols_overview("src/tools/file.rs") to see structure first` |
| `Read("src/tools/file.rs", offset=100, limit=20)` | Pass through (targeted read) |
| `Grep("fn call", glob="*.rs")` | `Use search_for_pattern("fn call") or find_symbol("call")` |
| `Glob("src/**/*.rs")` | Pass through (broad discovery) |
| `Glob("src/tools/file.rs")` | `Use find_file("src/tools/file.rs") or find_symbol("file")` |

### 4. New hook: replace_content on source files

`edit-router.sh` — PreToolUse hook matching `replace_content`. When the target
path has a source extension, blocks with:

```
For code files, use symbol-aware or line-based editing:
  - replace_symbol_body("symbol_name", "path", new_body)
  - edit_lines("path", start_line, delete_count, new_text)
  - insert_before_symbol / insert_after_symbol
replace_content is for non-code files only.
```

## File Layout

```
hooks/
  detect-tools.sh              # Shared detection + config (add workspace_root, block_reads)
  hooks.json                   # Hook registration (add replace_content matcher)
  session-start.sh             # Onboarding/memory preamble + guidance.txt
  subagent-guidance.sh          # guidance.txt (skip for Bash/statusline agents)
  semantic-tool-router.sh      # Blocks Grep/Glob/Read with specific redirects
  edit-router.sh               # NEW: blocks replace_content on source files
  guidance.txt                 # NEW: single-source guidance content
```

## hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": ".../session-start.sh" }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": ".../subagent-guidance.sh" }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Glob|Read",
        "hooks": [{ "type": "command", "command": ".../semantic-tool-router.sh" }]
      },
      {
        "matcher": "replace_content",
        "hooks": [{ "type": "command", "command": ".../edit-router.sh" }]
      }
    ]
  }
}
```

The `replace_content` matcher matches any tool with that substring. `edit-router.sh`
verifies it's the code-explorer MCP tool (checks against `CE_SERVER_NAME`) before
blocking.
