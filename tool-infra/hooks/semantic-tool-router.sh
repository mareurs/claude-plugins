#!/bin/bash
# PreToolUse hook - redirect Grep/Glob/Read on source files to semantic tools
# Auto-detects available MCP servers and project languages.
# If no semantic tools available, allows everything.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# Blocking requires symbol-level tools (serena/intellij) that can replace Read/Grep/Glob.
# claude-context alone provides discovery but not symbol-level reading — don't block without alternatives.
if [ "$HAS_SERENA" = "false" ] && [ "$HAS_INTELLIJ" = "false" ]; then
  exit 0
fi

# Build suggestion messages based on available tools
GREP_SUGGESTIONS=""
GLOB_SUGGESTIONS=""
READ_SUGGESTIONS=""

if [ "$HAS_CONTEXT" = "true" ]; then
  GREP_SUGGESTIONS="Semantic search (natural language):\n- search_code(query) — describe what you're looking for"
  GLOB_SUGGESTIONS="Semantic search (natural language):\n- search_code(query) — describe what you're looking for"
  READ_SUGGESTIONS="Semantic search (natural language):\n- search_code(query) — describe what you're looking for"
fi

if [ "$HAS_SERENA" = "true" ] || [ "$HAS_INTELLIJ" = "true" ]; then
  LSP_GREP=""
  LSP_GLOB=""
  LSP_READ=""

  if [ "$HAS_SERENA" = "true" ]; then
    LSP_GREP="- find_symbol(name_path, include_body=true) — read a specific symbol\n- search_for_pattern(substring_pattern) — regex/literal across source\n- find_referencing_symbols(name_path) — find all callers/usages"
    LSP_GLOB="- find_symbol(name_path) — find classes/functions by name\n- find_file(file_mask) — find files by name"
    LSP_READ="- get_symbols_overview(path) — see all symbols in a file first\n- find_symbol(name_path, include_body=true) — read specific symbol source"
  fi

  if [ "$HAS_INTELLIJ" = "true" ]; then
    [ -n "$LSP_GREP" ] && LSP_GREP="$LSP_GREP\n"
    [ -n "$LSP_GLOB" ] && LSP_GLOB="$LSP_GLOB\n"
    [ -n "$LSP_READ" ] && LSP_READ="$LSP_READ\n"
    LSP_GREP="${LSP_GREP}- ide_find_symbol(name) — find symbol by name\n- ide_find_references(name) — find all usages"
    LSP_GLOB="${LSP_GLOB}- ide_find_symbol(name) — find symbol by name\n- ide_find_file(name) — find file by name"
    LSP_READ="${LSP_READ}- ide_file_structure(path) — see structure of a file\n- ide_find_symbol(name) — find symbol by name"
  fi

  if [ -n "$GREP_SUGGESTIONS" ]; then
    GREP_SUGGESTIONS="$GREP_SUGGESTIONS\nLSP/IDE tools (need a symbol name):\n$LSP_GREP"
    GLOB_SUGGESTIONS="$GLOB_SUGGESTIONS\nLSP/IDE tools (need a symbol name):\n$LSP_GLOB"
    READ_SUGGESTIONS="$READ_SUGGESTIONS\nLSP/IDE tools:\n$LSP_READ"
  else
    GREP_SUGGESTIONS="LSP/IDE tools (need a symbol name):\n$LSP_GREP"
    GLOB_SUGGESTIONS="LSP/IDE tools (need a symbol name):\n$LSP_GLOB"
    READ_SUGGESTIONS="LSP/IDE tools:\n$LSP_READ"
  fi
fi

READ_SUGGESTIONS="${READ_SUGGESTIONS}\n\nIf you MUST read the entire file, use Read with an explicit limit (e.g. limit: 2000)."

# SOURCE_EXT_PATTERN is set by detect-tools.sh (language-aware or fallback)

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
      if echo "$GLOB" | grep -qiE "$SOURCE_EXT_PATTERN"; then
        IS_SOURCE=true
      elif echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN"; then
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

    if ! echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN"; then
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

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')
    OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')

    # Only intercept source files
    if ! echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN"; then
      exit 0
    fi

    # Allow targeted reads (offset or limit explicitly set = intentional)
    if [ -n "$LIMIT" ] || [ -n "$OFFSET" ]; then
      exit 0
    fi

    # Block whole-file reads on source files
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Reading entire source file. Use semantic tools instead:\n${READ_SUGGESTIONS}"
  }
}
EOF
    exit 0
    ;;
esac

exit 0
