#!/bin/bash
# PreToolUse hook - ensure Serena project is activated before use
# Uses a temp marker file as session flag (survives until reboot/tmp cleanup)
# Generic: derives project name from cwd basename

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

# Fast path: already activated (stat syscall, ~0.1ms)
[ -f "$MARKER" ] && exit 0

# Not activated — deny with guidance
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Serena project not activated yet. Run: check_onboarding_performed() then activate_project('${PROJECT_NAME}'). This only needs to happen once per session."
  }
}
EOF
