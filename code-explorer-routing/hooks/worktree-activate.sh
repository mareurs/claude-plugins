#!/bin/bash
# PostToolUse hook — after EnterWorktree:
#   1. Inject activate_project guidance (always)
#   2. Create .ce-worktree-pending marker (blocks writes until activate_project called)
#   3. Symlink .code-explorer/ into worktree (best-effort)
# No-op if code-explorer is not configured.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" = "EnterWorktree" ] || exit 0

# CWD at this point is the ORIGINAL project (before worktree switch)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Find the worktree path ---
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.tool_response.worktree_path // .tool_response.path // empty')

if [ -z "$WORKTREE_PATH" ]; then
  # Fallback: newest entry from git worktree list
  WORKTREE_PATH=$(git -C "$CWD" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' | tail -1 | sed 's/^worktree //')
fi

[ -z "$WORKTREE_PATH" ] && exit 0
[ -d "$WORKTREE_PATH" ] || exit 0

# --- Create pending marker BEFORE injecting guidance ---
# Marker signals: worktree entered, activate_project not yet called.
# worktree-write-guard.sh checks this; ce-activate-project.sh clears it.
touch "$WORKTREE_PATH/.ce-worktree-pending" 2>/dev/null

# --- Inject guidance (always, regardless of symlink success) ---
jq -n --arg ctx "WORKTREE DETECTED: code-explorer must switch to the worktree.
Call activate_project(\"$WORKTREE_PATH\") NOW as your next action.
MCP write tools (edit_lines, replace_symbol, insert_code, create_file) are BLOCKED
until activate_project is called — they would otherwise silently write to the wrong repo.
Do NOT run index_project in worktrees — the shared index is read-only here." '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'

# --- Symlink .code-explorer/ into worktree (best-effort) ---
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

DEST="$WORKTREE_PATH/.code-explorer"
if [ ! -e "$DEST" ]; then
  ln -s "$CE_DIR" "$DEST" 2>/dev/null
fi
