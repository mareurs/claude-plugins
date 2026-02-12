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
STEPS=""

if [ "$HAS_CONTEXT" = "true" ]; then
  STEPS="1. DISCOVER: search_code(query) — describe what you're looking for in natural language
   Examples: \"how are permissions checked\", \"error handling patterns\", \"API rate limiting\"
   Avoid exact names like \"class Foo\" — use find_symbol or Grep for those."
  if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
    STEPS="$STEPS\n2. DRILL DOWN: find_symbol(name_path) — read specific symbols found in step 1"
    STEPS="$STEPS\n3. CROSS-REFERENCE: find_referencing_symbols(name_path) — find all callers/usages"
  fi
elif [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  STEPS="1. FIND: find_symbol(name_path) — locate symbols by name"
  STEPS="$STEPS\n2. STRUCTURE: get_symbols_overview(path) — see what's in a file"
  STEPS="$STEPS\n3. CROSS-REFERENCE: find_referencing_symbols(name_path) — find all callers/usages"
fi

CONTEXT="CODE EXPLORATION WORKFLOW:\\n\\n${STEPS}\\n\\nPrefer semantic/LSP tools over Grep/Glob for source files. Grep is for non-source files only."

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
