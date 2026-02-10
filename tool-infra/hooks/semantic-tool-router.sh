#!/bin/bash
# PreToolUse hook - redirect Grep/Glob on source files to semantic tools
# Auto-detects available MCP servers. If no semantic tools, allows everything.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# If no semantic tools available, don't block anything
if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ] && [ "$HAS_CONTEXT" = "false" ]; then
  exit 0
fi

# Build suggestion messages based on available tools
GREP_SUGGESTIONS=""
GLOB_SUGGESTIONS=""

if [ "$HAS_CONTEXT" = "true" ]; then
  GREP_SUGGESTIONS="Semantic search (natural language):\n- search_code(query) — describe what you're looking for"
  GLOB_SUGGESTIONS="Semantic search (natural language):\n- search_code(query) — describe what you're looking for"
fi

if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  LSP_GREP=""
  LSP_GLOB=""

  if [ "$HAS_SERENA" = "true" ]; then
    LSP_GREP="- find_symbol(name_path, include_body=true) — read a specific symbol\n- search_for_pattern(substring_pattern) — regex/literal across source\n- find_referencing_symbols(name_path) — find all callers/usages"
    LSP_GLOB="- find_symbol(name_path) — find classes/functions by name\n- find_file(file_mask) — find files by name"
  fi

  if [ "$HAS_INTELLIJ" = "true" ]; then
    [ -n "$LSP_GREP" ] && LSP_GREP="$LSP_GREP\n"
    [ -n "$LSP_GLOB" ] && LSP_GLOB="$LSP_GLOB\n"
    LSP_GREP="${LSP_GREP}- ide_find_symbol(name) — find symbol by name\n- ide_find_references(name) — find all usages"
    LSP_GLOB="${LSP_GLOB}- ide_find_symbol(name) — find symbol by name\n- ide_find_file(name) — find file by name"
  fi

  if [ -n "$GREP_SUGGESTIONS" ]; then
    GREP_SUGGESTIONS="$GREP_SUGGESTIONS\nLSP/IDE tools (need a symbol name):\n$LSP_GREP"
    GLOB_SUGGESTIONS="$GLOB_SUGGESTIONS\nLSP/IDE tools (need a symbol name):\n$LSP_GLOB"
  else
    GREP_SUGGESTIONS="LSP/IDE tools (need a symbol name):\n$LSP_GREP"
    GLOB_SUGGESTIONS="LSP/IDE tools (need a symbol name):\n$LSP_GLOB"
  fi
fi

# Supported source file extensions
EXT_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp)$'

case "$TOOL_NAME" in
  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')

    case "$TYPE" in
      kotlin|kt|java|ts|typescript|js|javascript|py|python|go|rust|cs|csharp|rb|ruby|scala|swift|cpp|c) IS_SOURCE=true ;;
      *) IS_SOURCE=false ;;
    esac

    if [ "$IS_SOURCE" = "false" ]; then
      if echo "$GLOB" | grep -qiE "$EXT_PATTERN"; then
        IS_SOURCE=true
      elif echo "$PATH_VAL" | grep -qiE "$EXT_PATTERN"; then
        IS_SOURCE=true
      fi
    fi

    if [ "$IS_SOURCE" = "true" ]; then
      cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Grep on source files. Use these instead:\n${GREP_SUGGESTIONS}"
  }
}
EOF
      exit 0
    fi
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    if ! echo "$PATTERN" | grep -qiE "$EXT_PATTERN"; then
      exit 0
    fi

    BASENAME="${PATTERN##*/}"

    # Allow broad directory scans
    if [[ "$BASENAME" == "*."* && "${BASENAME:0:1}" != [A-Z] ]]; then
      exit 0
    fi
    if [[ "$BASENAME" == "*.kt" ]] || [[ "$BASENAME" == "*.java" ]] || [[ "$BASENAME" == "*.ts" ]] || [[ "$BASENAME" == "*.py" ]]; then
      exit 0
    fi

    # Block specific file lookups (basename starts with uppercase = named class/module)
    if [[ "$BASENAME" =~ ^[A-Z] ]]; then
      cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Looking for a specific source file by name. Use these instead:\n${GLOB_SUGGESTIONS}"
  }
}
EOF
      exit 0
    fi
    ;;
esac

exit 0
