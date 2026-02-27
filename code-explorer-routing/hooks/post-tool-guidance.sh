#!/bin/bash
# PostToolUse hook — warn when Read/Grep/Glob are used on source files
# Lets the tool succeed, then injects guidance to use code-explorer tools instead.
# The AI sees the warning and avoids repeating the pattern.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0
[ "$BLOCK_READS" = "false" ] && exit 0

# --- Helper: check if path is under workspace ---
is_in_workspace() {
  local file_path="$1"
  [ -z "$WORKSPACE_ROOT" ] && return 0
  if [[ "$file_path" != /* ]]; then
    file_path="${CWD}/${file_path}"
  fi
  [[ "$file_path" == "${WORKSPACE_ROOT}"* ]]
}

# --- Helper: emit warning via additionalContext ---
warn() {
  jq -n --arg ctx "$1" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
  exit 0
}

case "$TOOL_NAME" in
  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    IS_SOURCE=false
    case "$TYPE" in
      kotlin|kt|kts|java|ts|typescript|js|javascript|py|python|go|rust|cs|csharp|rb|ruby|scala|swift|cpp|c)
        IS_SOURCE=true ;;
    esac

    if [ "$IS_SOURCE" = "false" ]; then
      echo "$GLOB" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
      echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
    fi

    [ "$IS_SOURCE" = "false" ] && exit 0
    is_in_workspace "${PATH_VAL:-$CWD}" || exit 0

    warn "⚠ WARNING: Grep on source files is deprecated and will be blocked in the next update.
Use code-explorer tools instead — they are faster and more token-efficient:
  search_for_pattern(\"${PATTERN}\")  — regex across source files
  find_symbol(\"${PATTERN}\")         — find symbol by name
  semantic_search(\"${PATTERN}\")     — find code by meaning
This call succeeded, but future calls on source files WILL be denied."
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    BASENAME="${PATTERN##*/}"

    # Allow broad wildcard scans (e.g. **/*.ts for discovery)
    if [[ "$BASENAME" == "*."* ]]; then
      exit 0
    fi

    is_in_workspace "${PATTERN}" || exit 0

    # Warn only for specific named file lookups
    if [[ "$BASENAME" =~ ^[A-Z] ]] || [[ "$BASENAME" != "*"* ]]; then
      warn "⚠ WARNING: Glob on source files is deprecated and will be blocked in the next update.
Use code-explorer tools instead — they are faster and more token-efficient:
  find_file(\"${PATTERN}\")           — glob file discovery
  find_symbol(\"${BASENAME%.*}\")     — find symbol by name
This call succeeded, but future calls on source files WILL be denied."
    fi
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')
    OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')

    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Allow targeted reads (explicit limit or offset = intentional)
    [ -n "$LIMIT" ] || [ -n "$OFFSET" ] && exit 0

    is_in_workspace "$FILE_PATH" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    warn "⚠ WARNING: Read on source files is deprecated and will be blocked in the next update.
Use code-explorer symbol tools instead — they are faster and more token-efficient:
  get_symbols_overview(\"${REL_PATH}\")          — see all symbols + line numbers (do this FIRST)
  find_symbol(name, include_body=true)           — read a specific symbol body
  list_functions(\"${REL_PATH}\")                — fast offline function list
This call succeeded, but future calls on source files WILL be denied.
read_file (via code-explorer) is LAST RESORT — only with start_line + end_line, only after symbol tools fail."
    ;;
esac

exit 0
