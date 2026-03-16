#!/bin/bash
# PostToolUse hook — after activate_project is called:
#   1. Delete .cs-worktree-pending marker (unblocks write tools)
#   2. Inject confirmation via additionalContext

INPUT=$(cat)
# Guard: empty stdin (e.g. hook triggered but pipe closed before write) would
# cause jq to emit a parse error to stderr, which Claude Code reports as a hook
# error even when the script exits 0.
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only fire on activate_project calls
case "$TOOL_NAME" in
  *__activate_project) ;;
  *) exit 0 ;;
esac

# Extract the activated path from tool_input (what the agent passed in)
# Strip trailing slash to ensure path matches the marker location exactly
ACTIVATED_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty' 2>/dev/null | sed 's|/$||')

[ -z "$ACTIVATED_PATH" ] && exit 0

# Remove marker if it exists
MARKER="$ACTIVATED_PATH/.cs-worktree-pending"
if [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  jq -n --arg ctx "✓ codescout switched to: $ACTIVATED_PATH
Write tools (edit_lines, replace_symbol, etc.) are now unblocked for this worktree." '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
# If no marker, exit silently (normal activate_project on main project)
exit 0
