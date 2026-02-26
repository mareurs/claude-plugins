#!/bin/bash
# SessionStart hook — inject code-explorer tool guidance into main agent
# No-op if code-explorer is not configured for this project.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Worktree detection: skip auto-indexing if in a worktree ---
IN_WORKTREE=false
if git -C "$CWD" rev-parse --is-inside-work-tree &>/dev/null; then
  GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
  GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)
  # In a worktree, git-common-dir != git-dir
  if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
    IN_WORKTREE=true
  fi
fi

GUIDANCE=$(cat "$(dirname "$0")/guidance.txt")
MSG=""

# --- Onboarding check ---
if [ "$HAS_CE_ONBOARDING" = "false" ]; then
  MSG="CODE-EXPLORER: Project not yet onboarded.
Run the onboarding() tool first — it detects languages, creates project config,
and generates exploration memories that help every subsequent session.

"
fi

# --- Memory hint ---
if [ "$HAS_CE_MEMORIES" = "true" ]; then
  MSG="${MSG}CODE-EXPLORER MEMORIES: ${CE_MEMORY_NAMES}
→ Read relevant memories before exploring code (read_memory(\"architecture\"), etc.)

"
fi

# --- Tool guide ---
MSG="${MSG}${GUIDANCE}

NEVER USE BASH AGENTS FOR CODE WORK.
Bash agents have no code-explorer tools. Use general-purpose, Plan, or Explore
agents for any task involving code reading, writing, or navigation."

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
