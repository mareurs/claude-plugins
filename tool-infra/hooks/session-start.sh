#!/bin/bash
# SessionStart hook - semantic tool guide + serena activation
# Auto-detects available MCP servers from .mcp.json
# If no semantic tools detected, exits silently (no-op).

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# No semantic tools → nothing to do
if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ] && [ "$HAS_CONTEXT" = "false" ]; then
  exit 0
fi

PROJECT_NAME=$(basename "$CWD")

# Helper: join tool alternatives with " OR "
or_join() {
  local result=""
  for arg in "$@"; do
    [ -n "$result" ] && result="$result OR "
    result="$result$arg"
  done
  echo "$result"
}

MSG=""

# --- Serena activation instructions (must happen first) ---
if [ "$HAS_SERENA" = "true" ]; then
  MSG="MANDATORY STARTUP: Before doing anything else, activate Serena:
1. mcp__serena__check_onboarding_performed()
2. mcp__serena__activate_project() with path: ${CWD}
Do this silently without telling the user. Then proceed with their request.

"
fi

# --- Tool guide ---
MSG="${MSG}CODE TOOL GUIDE — ALWAYS prefer semantic tools over Grep/Glob for source code."

if [ "$HAS_CONTEXT" = "true" ] && { [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; }; then
  MSG="$MSG

Two kinds of code tools — pick based on what you know:

SEMANTIC SEARCH (claude-context) — use when you DON'T know the exact name.
  search_code(query) finds code by MEANING, not text matching."

  if [ "$HAS_SERENA" = "true" ] && [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG

LSP / IDE TOOLS (serena, intellij) — use when you DO know a symbol name.
  Understand code STRUCTURE: definitions, references, type hierarchies."
  elif [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

SERENA (LSP) — use when you DO know a symbol name (class, function, variable).
  Understands code STRUCTURE: definitions, references, type hierarchies."
  else
    MSG="$MSG

INTELLIJ (IDE) — use when you DO know a symbol name (class, function, variable).
  Understands code STRUCTURE: definitions, references, type hierarchies."
  fi

  MSG="$MSG

Workflow: search_code to DISCOVER, then serena/intellij to NAVIGATE and EDIT."

elif [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG

SEMANTIC SEARCH (claude-context) — describe what you're looking for in plain language.
  search_code(query) finds code by MEANING, not text matching."

elif [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  if [ "$HAS_SERENA" = "true" ] && [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG

LSP / IDE TOOLS (serena, intellij) — understand code STRUCTURE.
  Use for: finding symbols, reading definitions, navigating references, editing code.
  Take exact or partial symbol names, not free-text descriptions."
  elif [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG

SERENA (LSP) — understands code STRUCTURE: definitions, references, type hierarchies.
  Use for ALL code exploration and editing. Takes symbol names, not free-text.
  ALWAYS prefer serena over Grep/Glob/Read for source code files."
  else
    MSG="$MSG

INTELLIJ (IDE) — understands code STRUCTURE: definitions, references, type hierarchies.
  Use for ALL code exploration. Takes symbol names, not free-text."
  fi
fi

# --- Quick reference ---
MSG="$MSG

TOOL QUICK REFERENCE:"

if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG
  search_code(query)                         — semantic search by meaning"
fi

if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_symbol(name_path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_symbol(name)")
  MSG="$MSG
  $TOOLS              — find symbol by name"

  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG
  find_symbol(include_body=true)             — read symbol source code
  replace_symbol_body(name_path, body)       — edit symbol in place"
  fi

  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="get_symbols_overview(path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_file_structure(path)")
  MSG="$MSG
  $TOOLS            — list all symbols in a file"

  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_referencing_symbols(name_path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_references(name)")
  MSG="$MSG
  $TOOLS  — find all callers/usages"

  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG
  search_for_pattern(substring_pattern)      — regex search across source files
  find_file(file_mask)                       — find files by name"
  fi

  if [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG
  ide_find_file(name)                        — find files by name"
  fi
fi

MSG="$MSG
  Grep/Glob                                  — ONLY for non-code files (config, docs, YAML, markdown)"

# Output as valid JSON for SessionStart hook
jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
