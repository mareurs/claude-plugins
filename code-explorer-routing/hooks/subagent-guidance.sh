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

# Always inject an active tool-use directive so coding subagents don't fall back
# to Read/Grep/Glob/Bash on source files. Append project system-prompt if present.
MSG="CE: For ALL code navigation, use CE tools — not Read/Grep/Glob/Bash on source files:
  find_symbol / list_symbols / semantic_search — discover code
  goto_definition / find_references — navigate relationships
  replace_symbol / insert_code — edit code"

if [ "$HAS_CE_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}

${CE_SYSTEM_PROMPT}"
fi

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
