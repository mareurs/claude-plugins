#!/bin/bash
# SessionStart hook - semantic tool guide + exploration workflow
# Auto-detects available MCP servers and Serena project languages.
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

MSG=""

# --- Serena startup guidance ---
if [ "$HAS_SERENA" = "true" ]; then
  MSG="SERENA SETUP: The project is already activated via MCP server config.
Serena paths are RELATIVE to the project root — verify directories exist before searching."

  # Point to memories for project understanding instead of list_dir
  if [ "$HAS_SERENA_MEMORIES" = "true" ]; then
    MSG="$MSG
Serena has project memories: ${SERENA_MEMORY_NAMES}— read relevant ones to understand the project."
  fi

  MSG="$MSG
Use bash ls for directory browsing (faster, richer output than list_dir).

If Serena returns \"No active project\", call activate_project with path: ${CWD}
If Serena says \"onboarding not performed\", ignore it — the project works fine.

"
fi

# --- Tool guide ---
MSG="${MSG}CODE TOOL GUIDE — ALWAYS prefer semantic tools over Grep/Glob/Read for source code."

if [ "$HAS_CONTEXT" = "true" ] && { [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; }; then
  MSG="$MSG

Two kinds of code tools — pick based on what you know:

SEMANTIC SEARCH (claude-context) — use when you DON'T know the exact name.
  search_code(query) finds code by MEANING using embedded vectors, not text matching.

  GOOD queries (describe behavior/intent):
    search_code(\"how are API errors handled and returned to clients\")
    search_code(\"database connection setup and pooling\")

  BAD queries (use symbol tools or Grep instead):
    search_code(\"function checkPermission\")     → use find_symbol
    search_code(\"import retry from\")            → use Grep for literal patterns"

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
  search_code(query) finds code by MEANING using embedded vectors, not text matching.

  GOOD queries (describe behavior/intent):
    search_code(\"how are API errors handled and returned to clients\")
    search_code(\"database connection setup and pooling\")

  BAD queries (use symbol tools or Grep instead):
    search_code(\"function checkPermission\")     → use find_symbol
    search_code(\"import retry from\")            → use Grep for literal patterns"

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

# --- Exploration workflow (for main agent, not just subagents) ---
if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  STEP=1
  MSG="$MSG

CODE EXPLORATION WORKFLOW:"

  # Step 1: DISCOVER with claude-context when available
  if [ "$HAS_CONTEXT" = "true" ]; then
    MSG="$MSG
  ${STEP}. DISCOVER: search_code(query) — find relevant code by describing what you're looking for"
    STEP=$((STEP + 1))
  fi

  # Step 2: STRUCTURE
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="get_symbols_overview(path)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_file_structure(path)")
  MSG="$MSG
  ${STEP}. STRUCTURE: $TOOLS — see what's in a file BEFORE reading it"
  STEP=$((STEP + 1))

  # Step 3: READ
  if [ "$HAS_SERENA" = "true" ]; then
    MSG="$MSG
  ${STEP}. READ: find_symbol(name, include_body=true) — read only the symbols you need"
  elif [ "$HAS_INTELLIJ" = "true" ]; then
    MSG="$MSG
  ${STEP}. READ: ide_find_symbol(name) — read specific symbols"
  fi
  STEP=$((STEP + 1))

  # Step 4: NAVIGATE
  TOOLS=""
  [ "$HAS_SERENA" = "true" ] && TOOLS="find_referencing_symbols(name)"
  [ "$HAS_INTELLIJ" = "true" ] && TOOLS=$(or_join "$TOOLS" "ide_find_references(name)")
  MSG="$MSG
  ${STEP}. NAVIGATE: $TOOLS — trace callers/usages
  NEVER use Read to view entire source files. Use get_symbols_overview first, then read specific symbols."
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
