#!/bin/bash
# PreToolUse hook — enforcer for code-explorer tool routing
# Uses permissionDecision: deny + permissionDecisionReason (shown to Claude) for hard block + guidance.

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

# --- Helper: hard-block with reason shown to Claude ---
enforce() {
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
    enforce "WRONG TOOL. You called Bash but CE is available.

STOP. Do NOT run: ${CMD}

USE run_command(\"${CMD}\") INSTEAD. Here is why this matters:
- run_command returns SMART SUMMARIES — large output is stored in @ref buffers, saving THOUSANDS OF TOKENS
- Bash dumps ALL output into your context window, WASTING YOUR TOKEN BUDGET
- run_command provides dangerous command detection, structured error capture, and cwd parameter
- Output buffers can be queried: grep PATTERN @cmd_id, tail -20 @cmd_id

YOU MUST use run_command. Do not call Bash."
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

    enforce "WRONG TOOL. You called Grep on source files but CE has a FULL INDEX.

STOP. Do NOT grep source files.

Grep scans files line-by-line and dumps raw matches into context — WASTEFUL AND SLOW.
CE tools use a pre-built index and return STRUCTURED, TOKEN-EFFICIENT results:

  search_pattern(\"${PATTERN}\")    — regex search, returns only matching lines with context
  find_symbol(\"${PATTERN}\")       — locate symbol by name (MUCH faster than grep)
  semantic_search(\"${PATTERN}\")   — find code by MEANING, not just text

YOU MUST use CE search tools. Do not call Grep on source files."
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    BASENAME="${PATTERN##*/}"

    is_in_workspace "${PATTERN}" || exit 0

    enforce "WRONG TOOL. You called Glob on source files but CE has a FILE INDEX.

STOP. Do NOT glob source files.

CE has already indexed all files. Use the index directly — it is FASTER and uses FEWER TOKENS:

  find_file(\"${PATTERN}\")         — glob-style file discovery via CE index
  find_symbol(\"${BASENAME%.*}\")   — find a symbol by name if you know what you are looking for

YOU MUST use CE file tools. Do not call Glob on source files."
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    is_in_workspace "$FILE_PATH" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "WRONG TOOL. You called Read on a source file but CE has SYMBOL-LEVEL ACCESS.

STOP. Do NOT read: ${FILE_PATH}

Reading a full source file WASTES THOUSANDS OF TOKENS. CE returns ONLY what you need:

  list_symbols(\"${REL_PATH}\")              — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  find_symbol(name, include_body=true)       — ONE symbol body, targeted, token-efficient
  list_functions(\"${REL_PATH}\")           — function signatures only (offline, instant)
  read_file(\"${REL_PATH}\", start, end)    — LAST RESORT only, with explicit line range

MANDATORY ORDER: list_symbols FIRST → find_symbol for the specific code → read_file only if symbol tools fail.
Do not call Read on source files."
    ;;
esac

exit 0
