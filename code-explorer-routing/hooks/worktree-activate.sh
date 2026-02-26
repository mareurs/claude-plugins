#!/bin/bash
# PostToolUse hook — after EnterWorktree, symlink .code-explorer/ and inject activate_project guidance
# No-op if code-explorer is not configured.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" = "EnterWorktree" ] || exit 0

# CWD at this point is the ORIGINAL project (before worktree switch)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Find the worktree path ---
# PostToolUse tool_response may contain the worktree path.
# Also try deriving from tool_input.name + standard location.
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.tool_response.worktree_path // .tool_response.path // empty')

if [ -z "$WORKTREE_PATH" ]; then
  # Fallback: try to find from git worktree list (newest entry)
  WORKTREE_PATH=$(git -C "$CWD" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' | tail -1 | sed 's/^worktree //')
fi

[ -z "$WORKTREE_PATH" ] && exit 0
[ -d "$WORKTREE_PATH" ] || exit 0

# --- Find .code-explorer/ in original project ---
CE_DIR=""
CHECK="$CWD"
while [ "$CHECK" != "/" ]; do
  if [ -d "$CHECK/.code-explorer" ]; then
    CE_DIR="$CHECK/.code-explorer"
    break
  fi
  CHECK=$(dirname "$CHECK")
done

[ -z "$CE_DIR" ] && exit 0

# --- Symlink .code-explorer/ into worktree ---
DEST="$WORKTREE_PATH/.code-explorer"
if [ ! -e "$DEST" ]; then
  ln -s "$CE_DIR" "$DEST" 2>/dev/null
fi

# --- Inject guidance ---
jq -n --arg ctx "WORKTREE DETECTED: code-explorer must switch to the worktree.
Call activate_project(\"$WORKTREE_PATH\") NOW as your next action.
Do NOT run index_project in worktrees — the shared index is read-only here." '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
