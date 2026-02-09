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

# Not activated — deny with guidance
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Serena not activated yet. You must first: 1) check_onboarding_performed() 2) If not onboarded, run onboarding() 3) activate_project('${PROJECT_NAME}'). This only needs to happen once per session."
  }
}
EOF
