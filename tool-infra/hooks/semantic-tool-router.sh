#!/bin/bash
# PreToolUse hook - redirect Grep/Glob on source files to semantic tools
# When semantic tools (Serena, IntelliJ) are available, text search on source
# files is wasteful. This hook blocks and suggests the right semantic tool.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Supported source file extensions (languages with semantic tool support)
EXT_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp)$'

case "$TOOL_NAME" in
  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')

    # Known type aliases
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
      cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Grep on source files. Use semantic tools instead:\n- find_symbol(name_path, include_body=true) to read specific symbols\n- get_symbols_overview(relative_path) for file structure\n- search_for_pattern(substring_pattern) for regex across codebase\n- find_referencing_symbols(name_path) for usage tracking"
  }
}
EOF
      exit 0
    fi
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    # Check if targeting source files
    if ! echo "$PATTERN" | grep -qiE "$EXT_PATTERN"; then
      exit 0
    fi

    BASENAME="${PATTERN##*/}"

    # Allow broad directory scans: *.ext, *Test.ext, *Impl.ext
    if [[ "$BASENAME" == "*."* && "${BASENAME:0:1}" != [A-Z] ]]; then
      exit 0
    fi
    if [[ "$BASENAME" == "*.kt" ]] || [[ "$BASENAME" == "*.java" ]] || [[ "$BASENAME" == "*.ts" ]] || [[ "$BASENAME" == "*.py" ]]; then
      exit 0
    fi

    # Block specific file lookups (basename starts with uppercase = named class/module)
    if [[ "$BASENAME" =~ ^[A-Z] ]]; then
      cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: Looking for a specific source file by name. Use semantic tools instead:\n- find_symbol(name_path_pattern) to find classes/functions by name\n- find_file(file_mask) to find files by name\n- search_for_pattern(substring_pattern) for flexible search"
  }
}
EOF
      exit 0
    fi
    ;;
esac

exit 0
