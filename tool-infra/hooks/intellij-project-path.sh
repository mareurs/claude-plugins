#!/bin/bash
# PreToolUse hook for IntelliJ tools - auto-inject project_path if missing

INPUT=$(cat)

PROJECT_PATH=$(echo "$INPUT" | jq -r '.tool_input.project_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# If project_path is already set, allow without modification
if [ -n "$PROJECT_PATH" ]; then
  exit 0
fi

# If no cwd available, allow without modification
if [ -z "$CWD" ]; then
  exit 0
fi

# Merge original tool_input with project_path
MERGED_INPUT=$(echo "$INPUT" | jq --arg cwd "$CWD" '.tool_input + {project_path: $cwd}')

# Auto-inject project_path using cwd
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Auto-injected project_path=$CWD",
    "updatedInput": $MERGED_INPUT
  }
}
EOF
