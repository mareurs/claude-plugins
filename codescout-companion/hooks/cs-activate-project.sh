#!/bin/bash
# PostToolUse hook — after workspace is called:
#   1. Delete .cs-worktree-pending marker (unblocks write tools)
#   2. Inject confirmation via additionalContext

INPUT=$(cat)
# Guard: empty stdin (e.g. hook triggered but pipe closed before write) would
# cause jq to emit a parse error to stderr, which Claude Code reports as a hook
# error even when the script exits 0.
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only fire on workspace calls
case "$TOOL_NAME" in
  *__workspace|*__activate_project) ;;
  *) exit 0 ;;
esac

# Extract the activated path from tool_input (what the agent passed in)
# Strip trailing slash to ensure path matches the marker location exactly
ACTIVATED_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty' 2>/dev/null | sed 's|/$||')

[ -z "$ACTIVATED_PATH" ] && exit 0

# --- Write codescout-active marker (session-scoped workspace truth) ---
# Statusline reads this to display the agent's *declared* workspace branch
# instead of guessing from CC's frozen PWD. See docs/marker-convention.md.
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$SESSION_ID" ] && [ -d "$ACTIVATED_PATH" ]; then
  CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  mkdir -p "$CFG/codescout-active" 2>/dev/null
  printf '%s' "$ACTIVATED_PATH" > "$CFG/codescout-active/$SESSION_ID" 2>/dev/null
fi

# Remove .cs-worktree-pending marker if it exists (unblocks write tools)
MARKER="$ACTIVATED_PATH/.cs-worktree-pending"
if [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  jq -n --arg ctx "✓ codescout switched to: $ACTIVATED_PATH
Write tools (edit_code, create_file, etc.) are now unblocked for this worktree." '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
# If no marker, exit silently (normal workspace call on main project)
exit 0
