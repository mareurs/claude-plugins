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
    "permissionDecisionReason": "BLOCKED: find_referencing_symbols returns empty for Kotlin/Java (broken LSP cross-file refs). Use IntelliJ instead:\n1. ide_find_symbol(query=\"SymbolName\") — locate the symbol (get file + line + column)\n2. ide_find_references(file, line, column) — find all usages across the project\n\nNote: Serena single-file operations (get_symbols_overview, find_symbol, replace_symbol_body) still work fine."
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
    "permissionDecisionReason": "BLOCKED: rename_symbol may miss cross-file renames for Kotlin/Java (LSP limitation). Use IntelliJ instead:\n1. ide_find_symbol(query=\"SymbolName\") — locate the symbol (get file + line + column)\n2. ide_refactor_rename(file, line, column, newName) — semantic rename across entire codebase"
  }
}
EOF
      exit 0
    fi
    ;;
esac

exit 0
