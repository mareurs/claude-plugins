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
SERENA_PREFIX=$(echo "$TOOL_NAME" | sed 's/\(.*serena[^_]*__\).*/\1/')

# Not activated — single clear action, no multi-step instructions
# If onboarding is needed, Serena's activate_project will say so
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Call ${SERENA_PREFIX}activate_project with project_name '${PROJECT_NAME}' right now. Do NOT call any other Serena tool until this succeeds."
  }
}
EOF
