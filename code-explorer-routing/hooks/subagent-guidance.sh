#!/bin/bash
# SubagentStart hook — inject code-explorer guidance into all subagents
# Skips agents that don't do code work.

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Skip agents that don't need code exploration guidance
case "$AGENT_TYPE" in
  Bash|statusline-setup|claude-code-guide)
    exit 0
    ;;
esac

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# server_instructions from MCP already deliver generic tool guidance to every subagent.
# This hook only needs to inject project-specific content that server_instructions can't carry.
[ "$HAS_CE_SYSTEM_PROMPT" = "false" ] && exit 0

jq -n --arg ctx "$CE_SYSTEM_PROMPT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
