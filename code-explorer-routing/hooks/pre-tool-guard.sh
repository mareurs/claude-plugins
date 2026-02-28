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

    # Source extension appearing anywhere in the command string.
    CMD_SOURCE_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp)(\s|'"'"'|"|$|\\)'

    # Block grep/cat/head/tail on source files — use code-explorer read/search tools instead.
    if echo "$CMD" | grep -qE '\b(grep|cat|head|tail)\b'; then
      echo "$CMD" | grep -qiE "$CMD_SOURCE_PATTERN" || exit 0
      READ_CMD=$(echo "$CMD" | grep -oE '\b(grep|cat|head|tail)\b' | head -1)
      deny "⛔ BLOCKED: $READ_CMD on source files via Bash is not allowed.
Use code-explorer tools instead — they are faster and more token-efficient:
  search_pattern(\"pattern\")            — regex search across source files (replaces grep)
  find_symbol(\"name\")                  — find symbol by name
  semantic_search(\"concept\")           — find code by meaning
  list_symbols(\"file\")                 — see all symbols + line numbers (replaces head/cat)
  find_symbol(name, include_body=true)   — read one symbol body (replaces cat for functions)
  read_file(path, start_line, end_line)  — targeted line read (last resort, known lines only)"
    fi

    # Block sed -i (in-place editing) on source files.
    echo "$CMD" | grep -qE '\bsed\b[^#]*-[a-zA-Z]*i' || exit 0
    echo "$CMD" | grep -qiE "$CMD_SOURCE_PATTERN" || exit 0

    deny "⛔ BLOCKED: sed -i on source files is not allowed.
Use code-explorer symbol tools instead — they address code by name, not line position:
  edit_lines(path, start_line, count, text) — targeted line-range replacement (closest sed equivalent)
  replace_symbol(name_path, new_body)       — rewrite a function or method body
  insert_code(name_path, code, position)    — add code before/after a named symbol
  rename_symbol(name_path, new_name)        — rename a symbol everywhere via LSP
sed -i edits by text pattern and silently corrupts edits if the file changed since you last read it.
Symbol tools stay correct even when the file has been modified since your last read."
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
