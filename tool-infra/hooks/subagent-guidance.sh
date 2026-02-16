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

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
