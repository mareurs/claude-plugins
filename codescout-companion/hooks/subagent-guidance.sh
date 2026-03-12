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

[ "$HAS_CODESCOUT" = "false" ] && exit 0

# Always inject an active tool-use directive so coding subagents don't fall back
# to Read/Grep/Glob/Bash on source files. Append project system-prompt if present.
MSG="codescout: For ALL code navigation, use codescout tools — not Read/Grep/Glob/Bash on source files:
  find_symbol / list_symbols / semantic_search — discover code
  goto_definition / find_references — navigate relationships
  replace_symbol / insert_code — edit code"

# --- GitHub identity + repo context ---
if command -v gh &>/dev/null; then
  GH_USER=$(gh auth status 2>&1 | grep -oP 'Logged in to github\.com account \K\S+' | head -1)
  if [ -z "$GH_USER" ]; then
    GH_USER=$(gh auth status 2>&1 | grep -oP 'Logged in to github\.com as \K\S+' | head -1)
  fi
  if [ -n "$GH_USER" ]; then
    REMOTE_URL=$(git -C "$CWD" remote get-url origin 2>/dev/null)
    if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
      GH_OWNER="${BASH_REMATCH[1]}"
      GH_REPO="${BASH_REMATCH[2]%.git}"
      MSG="${MSG}
GitHub: @${GH_USER} | repo: ${GH_OWNER}/${GH_REPO}
→ For issues/PRs/repo ops: github_issue/github_pr/github_repo with owner=\"${GH_OWNER}\" repo=\"${GH_REPO}\"."
    fi
  fi
fi

if [ "$HAS_CS_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}

${CS_SYSTEM_PROMPT}"
fi

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
