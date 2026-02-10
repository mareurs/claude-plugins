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

MSG="CODE TOOL GUIDE"

# --- Explain tool categories based on what's available ---

if [ "$HAS_CONTEXT" = "true" ] && { [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; }; then
  # Both categories available — explain the distinction
  MSG="$MSG

You have two kinds of code tools. Pick based on what you know:

SEMANTIC SEARCH (claude-context) — vector embeddings, natural language
  Use when you DON'T know the exact name. Describe what you're looking for.
  \"where is lesson visibility checked\", \"error handling for auth failures\"
  search_code(query) finds code by MEANING, not by text matching."

  if [ "$HAS_SERENA" = "true" ] && [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG

LSP / IDE TOOLS (serena, intellij) — Language Server Protocol + IDE indices
  Use when you DO know a symbol name (class, function, variable).
  These understand code STRUCTURE: definitions, references, type hierarchies.
  They take exact or partial symbol names, not free-text descriptions."
  elif [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

LSP TOOLS (serena) — Language Server Protocol
  Use when you DO know a symbol name (class, function, variable).
  Serena understands code STRUCTURE: definitions, references, type hierarchies.
  It takes exact or partial symbol names, not free-text descriptions."
  else
    MSG="$MSG

IDE TOOLS (intellij) — IntelliJ IDE indices
  Use when you DO know a symbol name (class, function, variable).
  IntelliJ understands code STRUCTURE: definitions, references, type hierarchies.
  It takes exact or partial symbol names, not free-text descriptions."
  fi

  MSG="$MSG

Typical workflow: search_code to DISCOVER → then LSP tools to NAVIGATE."

elif [ "$HAS_CONTEXT" = "true" ]; then
  # Context only
  MSG="$MSG

SEMANTIC SEARCH (claude-context) — vector embeddings, natural language
  Describe what you're looking for in plain language.
  search_code(query) finds code by MEANING, not by text matching.
  \"where is lesson visibility checked\", \"error handling for auth failures\""

elif [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  # LSP/IDE only
  if [ "$HAS_SERENA" = "true" ] && [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG

LSP / IDE TOOLS (serena, intellij) — Language Server Protocol + IDE indices
  These understand code STRUCTURE: definitions, references, type hierarchies.
  They take exact or partial symbol names, not free-text descriptions."
  elif [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

LSP TOOLS (serena) — Language Server Protocol
  Serena understands code STRUCTURE: definitions, references, type hierarchies.
  It takes exact or partial symbol names, not free-text descriptions."
  else
    MSG="$MSG

IDE TOOLS (intellij) — IntelliJ IDE indices
  IntelliJ understands code STRUCTURE: definitions, references, type hierarchies.
  It takes exact or partial symbol names, not free-text descriptions."
  fi
fi

# --- Tool reference by intent ---
MSG="$MSG

TOOL REFERENCE:"

if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG
  search_code(query)                — semantic search: natural language → relevant code"
fi

if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then

  # Find symbol
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_symbol(name_path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_symbol(name)")
  MSG="$MSG
  $TOOLS  — find a symbol by name"

  # Read/edit symbol body (serena only)
  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG
  find_symbol(name_path, include_body=true)  — read a symbol's full source
  replace_symbol_body(name_path, new_body)   — edit a symbol in place"
  fi

  # File structure
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="get_symbols_overview(path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_file_structure(path)")
  MSG="$MSG
  $TOOLS  — list all symbols in a file"

  # Find usages
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_referencing_symbols(name_path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_references(name)")
  MSG="$MSG
  $TOOLS  — find all callers/usages"

  # Regex search (serena only)
  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG
  search_for_pattern(substring_pattern)      — regex/literal search across source files
    ⚠ parameter is substring_pattern, NOT pattern"
  fi

  # Find file
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_file(file_mask)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_file(name)")
  MSG="$MSG
  $TOOLS  — find files by name"

fi

MSG="$MSG
  Grep                                       — non-source files only (config, docs, JSON, YAML, markdown)

STARTUP TASK — load tool schemas now:"

# Build schema loading instructions
N=1
if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__claude-context-local__search_code', max_results=1)"
  N=$((N+1))
fi

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

MSG="$MSG

Execute these ToolSearch calls before responding to the user."

echo "$MSG"
