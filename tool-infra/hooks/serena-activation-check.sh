#!/bin/bash
# PreToolUse hook - Serena activation safety check
# Non-blocking reminder if agent skipped SessionStart activation

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only intercept serena tools (both direct and plugin variants)
if [[ "$TOOL_NAME" != mcp__serena__* && "$TOOL_NAME" != mcp__plugin_serena_serena__* ]]; then
  exit 0
fi

# Always allow these meta/setup tools
case "$TOOL_NAME" in
  *activate_project*|*check_onboarding*|*initial_instructions*|*onboarding*)
    # Mark successful activation
    SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"
    MARKER_DIR="$HOME/.claude-sdd/tmp/serena-activation"
    MARKER="$MARKER_DIR/$SESSION_ID"
    if [ -f "$MARKER" ]; then
      echo "activated" > "$MARKER"
    fi
    exit 0
    ;;
  *list_memories*|*read_memory*|*write_memory*|*edit_memory*|*delete_memory*|*open_dashboard*)
    # Allow memory and utility tools without activation check
    exit 0
    ;;
esac

# Check if activation completed this session
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"
MARKER="$HOME/.claude-sdd/tmp/serena-activation/$SESSION_ID"

if [ -f "$MARKER" ]; then
  STATUS=$(cat "$MARKER")
  if [ "$STATUS" = "activated" ]; then
    # All good, allow through
    exit 0
  fi
fi

# Activation still pending - remind agent (non-blocking)
cat << 'EOF'
{
  "systemMessage": "⚠️ Serena not activated yet. You were instructed to activate at session start. Please complete activation first:\n1. check_onboarding_performed()\n2. activate_project()\n\nThen retry this tool call."
}
EOF
