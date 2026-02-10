#!/bin/bash
# SessionStart hook - semantic tool reminder + schema pre-loading
# Auto-detects available MCP servers from .mcp.json
# If no semantic tools detected, exits silently (no-op).

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# No semantic tools → nothing to do
if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ] && [ "$HAS_CONTEXT" = "false" ]; then
  exit 0
fi

# Helper: join tool alternatives with " OR "
or_join() {
  local result=""
  for arg in "$@"; do
    [ -n "$result" ] && result="$result OR "
    result="$result$arg"
  done
  echo "$result"
}

# Build decision-oriented tool guide
MSG="TOOL SELECTION GUIDE — pick by intent:"

# --- Semantic / free-text search ---
if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG

Find code by meaning, concept, or error message → claude-context search_code
  Natural language queries: \"where is visibility validated\", \"Cannot modify lesson\"
  Best for: exploring unfamiliar code, searching by intent, error strings"
fi

# --- Symbol-level tools (serena and/or intellij) ---
if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then

  # Find symbol by name
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="serena find_symbol"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "intellij ide_find_symbol")
  MSG="$MSG

Find a symbol by name → $TOOLS
  Know the class/function name (or partial): \"TeacherService\", \"handleLogin\""

  # Read/edit symbol body (serena only)
  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

Read/edit a symbol body → serena find_symbol(include_body=true) / replace_symbol_body
  Read or modify a specific function/class by its qualified name"
  fi

  # File structure
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="serena get_symbols_overview"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "intellij ide_file_structure")
  MSG="$MSG

See file structure → $TOOLS
  List all symbols in a file without reading the whole file"

  # Find usages
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="serena find_referencing_symbols"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "intellij ide_find_references")
  MSG="$MSG

Find all usages/callers → $TOOLS
  Who calls this function? Who uses this class?"

  # Regex search in source (serena only)
  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

Search by exact string/regex in source → serena search_for_pattern
  IMPORTANT: parameter is substring_pattern (NOT pattern)
  For literal strings or regex across all source files"
  fi

  # Find file by name
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="serena find_file"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "intellij ide_find_file")
  MSG="$MSG

Find a file by name → $TOOLS"

fi

MSG="$MSG

Search non-source files (config, docs, markdown, JSON, YAML) → Grep
  Grep is ONLY for non-source files. Use the tools above for source code.

STARTUP TASK - Load tool schemas now:"

# Build schema loading instructions
N=1
if [ "$HAS_SERENA" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__find_symbol', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__search_for_pattern', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__get_symbols_overview', max_results=1)"
  N=$((N+1))
fi

if [ "$HAS_INTELLIJ" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_symbol', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_references', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_file', max_results=1)"
  N=$((N+1))
fi

if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__claude-context-local__search_code', max_results=1)"
  N=$((N+1))
fi

MSG="$MSG

Execute these ToolSearch calls before responding to the user."

echo "$MSG"
