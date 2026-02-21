#!/bin/bash
# PreToolUse hook - redirect broken Serena calls to IntelliJ equivalents
# Only active in dual-tool mode (both Serena and IntelliJ available).
# Projects can opt out via tool-infra.json capability flags.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# Only intercept in dual mode
if [ "$DUAL_MODE" = "false" ]; then
  exit 0
fi

case "$TOOL_NAME" in
  mcp__serena__find_referencing_symbols)
    if [ "$SERENA_REFERENCES_WORKS" = "false" ]; then
      cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: find_referencing_symbols does not work when IntelliJ is available (returns empty). Use instead:\n- ide_find_references(file, line, col) — find all callers/usages\n\nBridge: Use find_symbol(name) first to get file+line, then pass to ide_find_references."
  }
}
EOF
      exit 0
    fi
    ;;

  mcp__serena__rename_symbol)
    if [ "$SERENA_RENAME_WORKS" = "false" ]; then
      cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: rename_symbol breaks builds silently for cross-file renames when IntelliJ is available. Use instead:\n- ide_refactor_rename(file, line, col, newName) — semantic rename across entire codebase\n\nBridge: Use find_symbol(name) first to get file+line, then pass to ide_refactor_rename."
  }
}
EOF
      exit 0
    fi
    ;;
esac

exit 0
