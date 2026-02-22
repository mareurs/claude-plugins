#!/bin/bash
# SubagentStart hook - inject semantic tool workflow into ALL subagents
# Auto-detects available tools; no-op if none available.
# Skips agent types that don't do code work (Bash, statusline-setup, etc.)

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Skip agent types that don't need code exploration guidance
case "$AGENT_TYPE" in
  Bash|statusline-setup|claude-code-guide)
    exit 0
    ;;
esac

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ] && [ "$HAS_CONTEXT" = "false" ]; then
  exit 0
fi

if [ "$DUAL_MODE" = "true" ]; then

  if [ "$AGENT_TYPE" = "Plan" ]; then
    # --- Rich dual-tool guidance for Plan agents (they decide tool routing for the whole implementation) ---
    CONTEXT="DUAL-TOOL MODE (Serena + IntelliJ) — use this to plan tool usage in each step.

SERENA — Reading + Editing (all languages, single-file ops always work):
  get_symbols_overview(path)                — file/directory structure (3x cheaper than ide_file_structure)
  find_symbol(name_path, include_body=true) — read symbol source (full body, not just 4-line preview)
  replace_symbol_body(name_path, body)      — edit symbol in place
  insert_after_symbol / insert_before_symbol — add new code
  search_for_pattern(substring_pattern)     — regex search (code files only, no .md/.memory pollution)
  find_file(file_mask)                      — find files by name

INTELLIJ — Cross-File Navigation + Refactoring:
  ide_find_references(file, line, col)      — who calls this? (preferred over ide_call_hierarchy callers)
  ide_type_hierarchy(fqName)                — inheritance chain
  ide_find_implementations(fqName)          — interface implementations
  ide_refactor_rename(file, line, col, name) — rename across codebase
  ide_refactor_safe_delete(file, line, col) — impact analysis before deletion
  ide_find_symbol(name)                     — fuzzy/CamelCase symbol search"

    if [ "$HAS_CONTEXT" = "true" ]; then
      CONTEXT="$CONTEXT

CLAUDE-CONTEXT — Broad Discovery (start here when you DON'T know where to look):
  search_code(query)                        — find code by MEANING using embedded vectors
  Good queries: \"how are permissions checked\", \"error handling patterns\", \"API rate limiting\"
  Bad queries: \"class Foo\" or \"function bar\" — use find_symbol for exact names"
    fi

    CONTEXT="$CONTEXT

KNOWN ISSUES (plan around these):
  - ide_call_hierarchy callers: BROKEN (always empty) — plan ide_find_references instead
  - ide_search_text: returns .md and .serena/memories files — plan search_for_pattern for code-only search
  - ide_find_definition: returns 4-line preview only — plan find_symbol(include_body=true) for full source
  - Serena cross-file refs (find_referencing_symbols): works for Python/TypeScript, broken for Kotlin/Java (use ide_find_symbol + ide_find_references if IntelliJ available)

WORKFLOW PATTERNS (use in plan steps):"

    if [ "$HAS_CONTEXT" = "true" ]; then
      CONTEXT="$CONTEXT

  Discover Then Drill Down (when you DON'T know where to look):
    1. claude-context: search_code(\"describe what you need\") -> find relevant files
    2. Serena: get_symbols_overview(file)                      -> understand structure
    3. Serena: find_symbol(name, include_body)                 -> read specifics
    4. IntelliJ: ide_find_references(file,line,col)            -> trace callers"
    fi

    CONTEXT="$CONTEXT

  Understand Before Editing:
    1. Serena: get_symbols_overview(file)          -> structure
    2. Serena: find_symbol(name, include_body)      -> read method
    3. Serena: replace_symbol_body(name, new_body)  -> edit
    4. IntelliJ: ide_find_references(file,line,col) -> verify nothing broke

  Find Usages Before Refactoring:
    1. Serena: find_symbol(name)                    -> get file + line
    2. IntelliJ: ide_find_references(file,line,col) -> all usages
    3. IntelliJ: ide_refactor_rename(...)            -> rename everywhere

  Explore Unfamiliar Code:
    1. Serena: get_symbols_overview(dir/)            -> directory overview
    2. Serena: find_symbol(Class, depth=1)           -> class structure
    3. IntelliJ: ide_type_hierarchy(fqName)          -> inheritance
    4. IntelliJ: ide_find_implementations(fqName)    -> implementations

BRIDGE PATTERN: Serena find_symbol gives file+line -> pass to IntelliJ for cross-file operations.
Grep/Glob — ONLY for non-code files (config, docs, YAML, markdown).
NEVER use Read to view entire source files. Use get_symbols_overview first, then find_symbol(include_body=true)."

  else
    # --- Compact dual-tool guidance for other subagents ---
    CONTEXT="DUAL-TOOL MODE — Serena + IntelliJ have different roles:

SERENA (reading + editing — single-file ops always work):
  get_symbols_overview(path) — file structure (prefer over ide_file_structure, 3x cheaper)
  find_symbol(name_path, include_body=true) — read full symbol source
  replace_symbol_body(name_path, body) — edit symbol
  search_for_pattern(substring_pattern) — regex search (code-only, no .md pollution)

INTELLIJ (cross-file navigation + refactoring):
  ide_find_references(file, line, col) — find all callers/usages (prefer over ide_call_hierarchy)
  ide_type_hierarchy(fqName) — inheritance chain
  ide_find_implementations(fqName) — interface implementations
  ide_refactor_rename(file, line, col, newName) — rename across codebase"

    if [ "$HAS_CONTEXT" = "true" ]; then
      CONTEXT="$CONTEXT

CLAUDE-CONTEXT (broad discovery — start here when you DON'T know where to look):
  search_code(query) — find code by meaning, not exact names. Then drill down with Serena/IntelliJ."
    fi

    CONTEXT="$CONTEXT

BRIDGE: Serena find_symbol gives file+line -> pass to IntelliJ for references.
AVOID: ide_call_hierarchy callers (broken), ide_search_text (pollutes with .md files), ide_find_definition (4-line preview only).

NEVER use Read to view entire source files. Use get_symbols_overview first, then find_symbol(include_body=true).
If you MUST read a full source file, use Read with explicit limit (e.g. limit: 2000).
Grep/Glob are ONLY for non-code files (config, docs, YAML, markdown)."
  fi

else
  # --- Single-tool workflow (existing logic) ---
  # Build workflow steps based on available tools
  STEP=1
  STEPS=""

  if [ "$HAS_CONTEXT" = "true" ]; then
    STEPS="${STEP}. DISCOVER: search_code(query) — describe what you're looking for in natural language
   Examples: \"how are permissions checked\", \"error handling patterns\", \"API rate limiting\"
   Avoid exact names like \"class Foo\" — use find_symbol or Grep for those."
    STEP=$((STEP + 1))
  fi

  if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
    SEP=""
    [ -n "$STEPS" ] && SEP="\n"
    if [ "$HAS_SERENA" = "true" ]; then
      STEPS="${STEPS}${SEP}${STEP}. STRUCTURE: get_symbols_overview(path) — see what's in a file BEFORE reading it"
      STEP=$((STEP + 1))
      STEPS="$STEPS\n${STEP}. READ: find_symbol(name_path, include_body=true) — read specific symbols"
      STEP=$((STEP + 1))
      STEPS="$STEPS\n${STEP}. NAVIGATE: find_referencing_symbols(name_path) — find all callers/usages"
    elif [ "$HAS_INTELLIJ" = "true" ]; then
      STEPS="${STEPS}${SEP}${STEP}. STRUCTURE: ide_file_structure(path) — see what's in a file"
      STEP=$((STEP + 1))
      STEPS="$STEPS\n${STEP}. READ: ide_find_symbol(name) — find and read symbols"
      STEP=$((STEP + 1))
      STEPS="$STEPS\n${STEP}. NAVIGATE: ide_find_references(name) — find all callers/usages"
    fi
  fi

  CONTEXT="CODE EXPLORATION WORKFLOW:\n\n${STEPS}\n\nALWAYS prefer semantic/LSP tools over Grep/Glob/Read for source files.\nNEVER use Read to view entire source files — use get_symbols_overview first, then find_symbol(include_body=true) for specific symbols.\nIf you MUST read a full source file, use Read with explicit limit (e.g. limit: 2000).\nGrep/Glob are ONLY for non-code files (config, docs, YAML, markdown)."

  # --- Plan agents get additional tool reference and known issues ---
  if [ "$AGENT_TYPE" = "Plan" ]; then
    if [ "$HAS_CONTEXT" = "true" ]; then
      CONTEXT="$CONTEXT

CLAUDE-CONTEXT TOOL REFERENCE (for plan steps):
  search_code(query)                        — find code by MEANING using embedded vectors
  Use as FIRST step when you don't know where to look. Describe behavior/intent, not exact names.
  Good: \"how are permissions checked\", \"error handling patterns\", \"API rate limiting\"
  Bad: \"class Foo\" — use find_symbol for exact names, Grep for literal strings
  Workflow: search_code to DISCOVER files -> then Serena/IntelliJ to NAVIGATE and EDIT"
    fi

    if [ "$HAS_SERENA" = "true" ]; then
      CONTEXT="$CONTEXT

SERENA TOOL REFERENCE (for plan steps):
  get_symbols_overview(path)                — file/directory structure overview
  find_symbol(name_path, include_body=true) — read specific symbol source code
  find_symbol(name_path, depth=1)           — list class members without reading bodies
  replace_symbol_body(name_path, body)      — edit symbol in place
  insert_after_symbol / insert_before_symbol — add new code at symbol boundaries
  find_referencing_symbols(name_path)       — cross-file callers/usages
  search_for_pattern(substring_pattern)     — regex search with directory scoping
  find_file(file_mask)                      — find files by name

PLAN AROUND THESE:
  - find_referencing_symbols: works for Python/TypeScript/Bash, broken for Kotlin/Java (returns empty)
  - For Kotlin/Java cross-file refs: ide_find_symbol(query) → ide_find_references(file, line, col) if IntelliJ available, else search_for_pattern"
    fi

    if [ "$HAS_INTELLIJ" = "true" ]; then
      CONTEXT="$CONTEXT

INTELLIJ TOOL REFERENCE (for plan steps):
  ide_find_references(file, line, col)      — cross-file callers/usages (always works)
  ide_type_hierarchy(fqName)                — inheritance chain
  ide_find_implementations(fqName)          — interface implementations
  ide_refactor_rename(file, line, col, name) — rename across codebase
  ide_refactor_safe_delete(file, line, col) — impact analysis before deletion
  ide_find_symbol(name)                     — fuzzy/CamelCase symbol search
  ide_file_structure(path)                  — file symbol tree

PLAN AROUND THESE:
  - ide_call_hierarchy callers: BROKEN (always empty) — plan ide_find_references instead
  - ide_search_text: returns .md/.memory files too — plan search_for_pattern for code-only
  - ide_find_definition: 4-line preview only — plan find_symbol(include_body=true) if available"
    fi
  fi
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
