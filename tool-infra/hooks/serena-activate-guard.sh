#!/bin/bash
# PreToolUse hook - safety net ensuring Serena is activated before use
# Primary activation happens via serena-session-start.sh at SessionStart
# This is a fallback if Claude skips or hasn't completed activation yet

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_NAME=$(basename "${CWD:-unknown}")
MARKER="/tmp/.serena-active-${PROJECT_NAME}"

# On activate_project call: create marker and allow
case "$TOOL_NAME" in
  *activate_project*)
    touch "$MARKER"
    exit 0
    ;;
  *check_onboarding*|*initial_instructions*|*onboarding*|*list_memories*|*read_memory*|*write_memory*|*edit_memory*|*delete_memory*|*open_dashboard*)
    exit 0
    ;;
esac

# Fast path: already activated
[ -f "$MARKER" ] && exit 0

# Derive the Serena tool prefix from the blocked tool name
# e.g. mcp__serena__find_symbol -> mcp__serena__
#      mcp__plugin_serena_serena__find_symbol -> mcp__plugin_serena_serena__
SERENA_PREFIX=$(echo "$TOOL_NAME" | sed 's/\(.*serena[^_]*__\).*/\1/')

# Not activated — deny with guidance
# Include exact tool names so Claude knows what MCP tools to call
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Serena project not activated. You MUST call the Serena MCP tool ${SERENA_PREFIX}activate_project with project_name '${PROJECT_NAME}'. First call ${SERENA_PREFIX}check_onboarding_performed, and if not onboarded run ${SERENA_PREFIX}onboarding. Then call ${SERENA_PREFIX}activate_project. Do NOT retry your original tool call until activate_project succeeds."
  }
}
EOF
