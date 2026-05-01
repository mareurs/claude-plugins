#!/bin/bash
# PostToolUse hook — after EnterWorktree:
#   1. Inject workspace guidance (always)
#   2. Create .cs-worktree-pending marker (blocks writes until workspace called)
#   3. Symlink .codescout/ into worktree (best-effort)
# No-op if code-explorer is not configured.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

[ "$TOOL_NAME" = "EnterWorktree" ] || exit 0

# CWD at this point is the ORIGINAL project (before worktree switch)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODESCOUT" = "false" ] && exit 0

# --- Find the worktree path ---
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.tool_response.worktree_path // .tool_response.path // empty')

if [ -z "$WORKTREE_PATH" ]; then
  # Fallback: most recently created linked worktree (by mtime).
  # git worktree list order is not creation-time order, so tail -1 is unreliable
  # when multiple worktrees exist.
  MAIN_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
  WORKTREE_PATH=$(
    git -C "$CWD" worktree list --porcelain 2>/dev/null \
      | grep '^worktree ' | sed 's/^worktree //' \
      | grep -v "^${MAIN_ROOT}$" \
      | while IFS= read -r wt; do
          [ -d "$wt" ] || continue
          printf '%s\t%s\n' "$(stat -c %Y "$wt" 2>/dev/null)" "$wt"
        done \
      | sort -rn | head -1 | cut -f2
  )
fi

[ -z "$WORKTREE_PATH" ] && exit 0
[ -d "$WORKTREE_PATH" ] || exit 0

# --- Create pending marker BEFORE injecting guidance ---
# Marker signals: worktree entered, workspace not yet called.
# worktree-write-guard.sh checks this; ce-activate-project.sh clears it.
touch "$WORKTREE_PATH/.cs-worktree-pending" 2>/dev/null

# --- Inject guidance (always, regardless of symlink success) ---
jq -n --arg ctx "WORKTREE DETECTED: codescout must switch to the worktree.
Call workspace(\"$WORKTREE_PATH\") NOW as your next action.
MCP write tools (edit_lines, replace_symbol, insert_code, create_file, create_or_update_file) are BLOCKED
until workspace is called — they would otherwise silently write to the wrong repo.
Do NOT run index in worktrees — the shared index is read-only here." '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'

# --- Symlink .codescout/ (or .code-explorer/) into worktree (best-effort) ---
# Walk up from original project CWD to find the project dir (.codescout preferred).
CE_DIR=""
CHECK="$CWD"
while [ "$CHECK" != "/" ]; do
  if [ -d "$CHECK/.codescout" ]; then
    CE_DIR="$CHECK/.codescout"
    break
  elif [ -d "$CHECK/.code-explorer" ]; then
    CE_DIR="$CHECK/.code-explorer"
    break
  fi
  CHECK=$(dirname "$CHECK")
done

# If neither dir exists yet (server not run on main project), create .codescout so
# the symlink can be established immediately. The server writes project.toml on first run.
if [ -z "$CE_DIR" ]; then
  MAIN_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$MAIN_ROOT" ]; then
    mkdir -p "$MAIN_ROOT/.codescout" 2>/dev/null && CE_DIR="$MAIN_ROOT/.codescout"
  fi
fi

[ -z "$CE_DIR" ] && exit 0

# Symlink name in worktree matches main project (preserves backwards compat for old projects)
DEST="$WORKTREE_PATH/$(basename "$CE_DIR")"
if [ ! -e "$DEST" ]; then
  ln -s "$CE_DIR" "$DEST" 2>/dev/null
fi
# Fallback: worktree has a real .codescout dir — symlink individual shared assets
if [ -d "$DEST" ] && [ ! -L "$DEST" ]; then
  for ASSET in embeddings; do
    SRC="${CE_DIR}/${ASSET}"
    DST="${DEST}/${ASSET}"
    [ -e "$SRC" ] || continue
    if [ -e "$DST" ] || [ -L "$DST" ]; then continue; fi
    ln -s "$SRC" "$DST" 2>/dev/null
  done
fi
