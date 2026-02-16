#!/bin/bash
# SubagentStart hook - inject semantic tool workflow into Explore agents
# Auto-detects available tools; no-op if none available.

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

if [ "$AGENT_TYPE" != "Explore" ]; then
  exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ] && [ "$HAS_CONTEXT" = "false" ]; then
  exit 0
fi

# Build workflow steps based on available tools
STEP=1
STEPS=""

if [ "$HAS_CONTEXT" = "true" ]; then
  STEPS="${STEP}. DISCOVER: search_code(query) — describe what you're looking for in natural language\n   Examples: \"how are permissions checked\", \"error handling patterns\", \"API rate limiting\"\n   Avoid exact names like \"class Foo\" — use find_symbol or Grep for those."
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

CONTEXT="CODE EXPLORATION WORKFLOW:\\n\\n${STEPS}\\n\\nPrefer semantic/LSP tools over Grep/Glob/Read for source files. Use get_symbols_overview before reading. Grep is for non-source files only."

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
