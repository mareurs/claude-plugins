#!/bin/bash
# PreToolUse hook - Auto-correct common MCP tool parameter name errors
# Denies calls with wrong param names and tells Claude the correct name,
# so Claude retries with the right parameter.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only intercept MCP tool calls
if [[ "$TOOL_NAME" != mcp__* ]]; then
  exit 0
fi

# Parameter name corrections: "tool_name|wrong_param|correct_param"
CORRECTIONS=(
  "mcp__serena__search_for_pattern|pattern|substring_pattern"
  "mcp__serena__edit_memory|old_string|needle"
  "mcp__serena__edit_memory|new_string|repl"
)

for correction in "${CORRECTIONS[@]}"; do
  IFS='|' read -r tool wrong correct <<< "$correction"

  if [ "$TOOL_NAME" = "$tool" ]; then
    if echo "$INPUT" | jq -e ".tool_input.$wrong" > /dev/null 2>&1; then
      REASON="Wrong parameter name: '$wrong' should be '$correct'. Retry with the correct parameter name."
      jq -n --arg reason "$REASON" '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
      exit 0
    fi
  fi
done

exit 0
