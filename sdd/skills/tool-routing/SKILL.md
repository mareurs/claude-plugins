---
name: tool-routing
description: Use when exploring, searching, reading, or editing source code -- routes to semantic tools (Serena) instead of Read/Grep/Glob where appropriate
---

# Tool Routing Decision Tree

## FINDING code (don't know location)

- **Know name/partial name** -> `find_symbol` (Serena)
  - Use `name_path_pattern` with optional `substring_matching=true`
  - Pass `relative_path` to narrow scope if known
- **Know concept/pattern** -> `search_for_pattern` or `search_code` (Serena)
  - `search_code` for semantic search, `search_for_pattern` for regex
- **Know file path** -> `get_symbols_overview` (Serena)
  - Quick map of classes, methods, functions before diving deeper

## READING code (know location)

- **One method/function** -> `find_symbol(name_path, include_body=true)` (Serena)
  - Returns just the method body, not entire file
- **Class shape/structure** -> `get_symbols_overview(relative_path)` (Serena)
  - See all methods, fields at a glance without full bodies
- **Full file contents** -> `Read` (built-in)
  - Only when genuinely need every line (imports, comments, etc.)

## EDITING code

- **Replace method/function** -> `find_symbol` then `replace_symbol_body` (Serena)
  - Surgical replacement of just the method
- **Add new code** -> `insert_after_symbol` / `insert_before_symbol` (Serena)
  - Add methods, imports, classes at precise locations
- **Simple text/string change** -> `Edit` tool (built-in)
  - For literal string replacements across files

## TRACING usage

- **Find all callers/references** -> `find_referencing_symbols` (Serena)
  - Shows where a symbol is used across codebase

## NON-CODE files (.md, .json, .yaml, .sql, .xml, .txt, .toml)

- Use `Grep`, `Read`, `Glob` (built-in tools)
- Serena is for programming language source files only

## Key Rules

1. **ALWAYS pass `relative_path` to `find_symbol`** for performance and precision
2. **Prefer symbol reads over file reads** - more efficient, less noise
3. **Serena for code, built-in tools for non-code** - clear separation
4. **Start with `get_symbols_overview`** to understand file structure before reading specific methods
