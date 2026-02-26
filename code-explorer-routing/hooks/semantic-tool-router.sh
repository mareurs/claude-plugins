#!/bin/bash
# PreToolUse hook — redirect Grep/Glob/Read on source files to code-explorer tools
# Pass-through for non-code files, files outside workspace, and when blocking is disabled.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0
[ "$BLOCK_READS" = "false" ] && exit 0

# --- Helper: check if path is under workspace ---
is_in_workspace() {
  local file_path="$1"
  # No workspace configured = block everything (original behavior)
  [ -z "$WORKSPACE_ROOT" ] && return 0
  # Make path absolute if relative
  if [[ "$file_path" != /* ]]; then
    file_path="${CWD}/${file_path}"
  fi
  # Check if under workspace root
  [[ "$file_path" == "${WORKSPACE_ROOT}"* ]]
}

# --- Helper: emit deny response ---
deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
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

    deny "BLOCKED: Use code-explorer for source file search:
  search_for_pattern(\"${PATTERN}\")  — regex across source files
  find_symbol(\"${PATTERN}\")         — find symbol by name
  semantic_search(\"${PATTERN}\")     — find code by meaning
⚠ ALL Grep/Glob/Read calls on source files are blocked by policy — do not retry. Only code-explorer tools will work. Read/Grep/Glob are allowed ONLY for .md, .json, .toml, .yaml, and other non-source files."
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

    # Block specific named file lookups
    if [[ "$BASENAME" =~ ^[A-Z] ]] || [[ "$BASENAME" != "*"* ]]; then
      deny "BLOCKED: Use code-explorer for source file discovery:
  find_file(\"${PATTERN}\")           — glob file discovery
  find_symbol(\"${BASENAME%.*}\")     — find symbol by name
⚠ ALL Grep/Glob/Read calls on source files are blocked by policy — do not retry. Only code-explorer tools will work. Read/Grep/Glob are allowed ONLY for .md, .json, .toml, .yaml, and other non-source files."
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

    deny "BLOCKED: Use symbol tools instead of reading whole files:
  get_symbols_overview(\"${REL_PATH}\")          — see all symbols + line numbers (do this FIRST)
  find_symbol(name, include_body=true)           — read a specific symbol body
  list_functions(\"${REL_PATH}\")                — fast offline function list
⚠ ALL Grep/Glob/Read calls on source files are blocked by policy — do not retry. Only code-explorer tools will work. Read/Grep/Glob are allowed ONLY for .md, .json, .toml, .yaml, and other non-source files.
read_file (via code-explorer) is LAST RESORT — only with start_line + end_line, only after symbol tools fail."
    ;;
esac

exit 0
