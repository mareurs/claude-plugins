#!/bin/bash
# PreToolUse hook — hard-block Read/Grep/Glob/Bash(sed -i) on source files
# Emits a deny decision so the tool never runs; agent must use code-explorer instead.

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

# --- Helper: emit deny decision ---
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
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

    # Block ALL Bash when code-explorer is available.
    # Agents should use run_command() instead — it provides smart output
    # summaries, buffer refs for querying, and dangerous command detection.
    deny "⛔ Use run_command(\"$(echo "$CMD" | head -c 80)\") instead of Bash.
run_command provides:
  - Smart output summaries (test pass/fail, build errors)
  - Output buffers queryable with grep/tail/awk/sed @output_id
  - Dangerous command detection with acknowledge_risk escape hatch
  - Runs in project root with optional cwd parameter"
    ;;

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

    deny "⛔ BLOCKED: Grep on source files is not allowed.
Use code-explorer tools instead — they are faster and more token-efficient:
  search_pattern(\"${PATTERN}\")      — regex across source files
  find_symbol(\"${PATTERN}\")         — find symbol by name
  semantic_search(\"${PATTERN}\")     — find code by meaning"
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
      deny "⛔ BLOCKED: Glob on source files is not allowed.
Use code-explorer tools instead — they are faster and more token-efficient:
  find_file(\"${PATTERN}\")           — glob file discovery
  find_symbol(\"${BASENAME%.*}\")     — find symbol by name"
    fi
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')
    OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')

    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Allow targeted reads (explicit limit or offset = intentional, agent knows what it needs)
    [ -n "$LIMIT" ] || [ -n "$OFFSET" ] && exit 0

    is_in_workspace "$FILE_PATH" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    deny "⛔ BLOCKED: Read on source files is not allowed.
Use code-explorer symbol tools instead — they are faster and more token-efficient:
  list_symbols(\"${REL_PATH}\")                  — see all symbols + line numbers (do this FIRST)
  find_symbol(name, include_body=true)           — read a specific symbol body
  list_functions(\"${REL_PATH}\")                — fast offline function list
read_file (via code-explorer) is LAST RESORT — only with start_line + end_line, only after symbol tools fail."
    ;;
esac

exit 0
