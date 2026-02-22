#!/bin/bash
# PreToolUse hook - Auto-correct common MCP tool parameter name errors
# Silently renames wrong params so the call succeeds on the first attempt.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only intercept MCP tool calls
if [[ "$TOOL_NAME" != mcp__* ]]; then
  exit 0
fi

MODIFIED=false
CURRENT="$INPUT"

# Parameter name corrections: "tool_name|wrong_param|correct_param"
# All matching corrections are applied before output (supports multiple fixes per call).
CORRECTIONS=(
  "mcp__serena__search_for_pattern|pattern|substring_pattern"
  "mcp__serena__find_symbol|name_path|name_path_pattern"
  "mcp__serena__edit_memory|old_string|needle"
  "mcp__serena__edit_memory|new_string|repl"
  "mcp__intellij-index__ide_find_references|query|file"
)

for correction in "${CORRECTIONS[@]}"; do
  IFS='|' read -r tool wrong correct <<< "$correction"

  if [ "$TOOL_NAME" = "$tool" ]; then
    if echo "$CURRENT" | jq -e ".tool_input.$wrong" > /dev/null 2>&1; then
      CURRENT=$(echo "$CURRENT" | jq ".tool_input.$correct = .tool_input.$wrong | del(.tool_input.$wrong)")
      MODIFIED=true
    fi
  fi
done

# Value coercions: fix wrong types for specific params.
# Applied after param renames so corrected param names are already in place.
if [ "$TOOL_NAME" = "mcp__serena__find_symbol" ]; then
  if echo "$CURRENT" | jq -e '.tool_input.include_body | type == "string"' > /dev/null 2>&1; then
    CURRENT=$(echo "$CURRENT" | jq '.tool_input.include_body = (.tool_input.include_body == "true")')
    MODIFIED=true
  fi
fi

if [ "$MODIFIED" = "true" ]; then
  echo "$CURRENT"
fi

exit 0
