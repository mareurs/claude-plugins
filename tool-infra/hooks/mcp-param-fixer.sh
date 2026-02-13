#!/bin/bash
# PreToolUse hook - Auto-correct common MCP tool parameter name errors
# Silently renames wrong params so the call succeeds on the first attempt.

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
  "mcp__intellij-index__ide_find_references|query|file"
)

for correction in "${CORRECTIONS[@]}"; do
  IFS='|' read -r tool wrong correct <<< "$correction"

  if [ "$TOOL_NAME" = "$tool" ]; then
    if echo "$INPUT" | jq -e ".tool_input.$wrong" > /dev/null 2>&1; then
      # Auto-correct: rename parameter and pass through
      echo "$INPUT" | jq ".tool_input.$correct = .tool_input.$wrong | del(.tool_input.$wrong)"
      exit 0
    fi
  fi
done

exit 0
