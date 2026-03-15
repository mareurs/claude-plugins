#!/bin/bash
# PreToolUse hook — enforcer for code-explorer tool routing
# Uses permissionDecision: deny + permissionDecisionReason (shown to Claude) for hard block + guidance.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODESCOUT" = "false" ] && exit 0
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
    enforce "WRONG TOOL. You called Bash but codescout is available.

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

    enforce "WRONG TOOL. You called Grep on source files but codescout has a FULL INDEX.

STOP. Do NOT grep source files.

Grep scans files line-by-line and dumps raw matches into context — WASTEFUL AND SLOW.
CE tools use a pre-built index and return STRUCTURED, TOKEN-EFFICIENT results:

  search_pattern(\"${PATTERN}\")    — regex search, returns only matching lines with context
  find_symbol(\"${PATTERN}\")       — locate symbol by name (MUCH faster than grep)
  semantic_search(\"${PATTERN}\")   — find code by MEANING, not just text

YOU MUST use codescout search tools. Do not call Grep on source files."
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    BASENAME="${PATTERN##*/}"

    is_in_workspace "${PATTERN}" || exit 0

    enforce "WRONG TOOL. You called Glob on source files but codescout has a FILE INDEX.

STOP. Do NOT glob source files.

codescout has already indexed all files. Use the index directly — it is FASTER and uses FEWER TOKENS:

  find_file(\"${PATTERN}\")         — glob-style file discovery via codescout index
  find_symbol(\"${BASENAME%.*}\")   — find a symbol by name if you know what you are looking for

YOU MUST use codescout file tools. Do not call Glob on source files."
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_in_workspace "$FILE_PATH" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    if echo "$FILE_PATH" | grep -qiE '\.md$'; then
      # Only guard .md files inside the current project
      [[ "$FILE_PATH" != "${CWD}"* ]] && exit 0
      # Exempt skill files (SKILL.md, files inside a skills/ directory)
      echo "$FILE_PATH" | grep -qiE '(^|/)skills/' && exit 0
      echo "$FILE_PATH" | grep -qiE '/SKILL\.md$' && exit 0
      enforce "WRONG TOOL. You called Read on a markdown file but codescout has HEADING-LEVEL NAVIGATION.

STOP. Do NOT read the full file: ${FILE_PATH}

Reading a full markdown file dumps all content into context — WASTEFUL when you need one section.
codescout read_file returns a STRUCTURAL SUMMARY with heading tree first, then lets you navigate:

  read_file(\"${REL_PATH}\")                         — heading tree summary (see full structure instantly)
  read_file(\"${REL_PATH}\", heading=\"## Section\")  — jump directly to a named section
  search_pattern(\"pattern\", path=\"${REL_PATH}\")   — find specific content within the file

WORKFLOW: read_file first to see the heading tree → then read_file with heading= to get the section.
Do not call Read on markdown files."
    fi

    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    enforce "WRONG TOOL. You called Read on a source file but codescout has SYMBOL-LEVEL ACCESS.

STOP. Do NOT read: ${FILE_PATH}

Reading a full source file WASTES THOUSANDS OF TOKENS. codescout returns ONLY what you need:

  list_symbols(\"${REL_PATH}\")              — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  find_symbol(name, include_body=true)       — ONE symbol body, targeted, token-efficient
  list_functions(\"${REL_PATH}\")           — function signatures only (offline, instant)
  read_file(\"${REL_PATH}\", start, end)    — LAST RESORT only, with explicit line range

MANDATORY ORDER: list_symbols FIRST → find_symbol for the specific code → read_file only if symbol tools fail.
Do not call Read on source files."
    ;;

  Edit)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_in_workspace "$FILE_PATH" || exit 0
    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "WRONG TOOL. You called Edit on a source file but codescout has LSP-BACKED SYMBOL EDITING.

STOP. Do NOT use the native Edit tool on: ${FILE_PATH}

The native Edit tool bypasses codescout's safety gates and LSP awareness.
codescout provides STRUCTURAL, LSP-BACKED editing tools:

  replace_symbol(name_path, path, new_body)   — replace a function/struct/class body via LSP
  insert_code(name_path, path, code, position) — insert before/after a named symbol
  remove_symbol(name_path, path)               — delete a symbol by name (LSP knows the exact range)
  edit_file(path, old_string, new_string)       — for imports, literals, comments, config (NOT structural code)

WORKFLOW: find_symbol(name, include_body=true) to read the current body → replace_symbol to update it.
Do not call Edit on source files."
    ;;

  Write)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_in_workspace "$FILE_PATH" || exit 0
    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "WRONG TOOL. You called Write on a source file but codescout has create_file.

STOP. Do NOT use the native Write tool on: ${FILE_PATH}

The native Write tool bypasses codescout's safety gates and file tracking.
Use codescout tools instead:

  create_file(path, content)                    — create or overwrite a file (tracked by codescout)
  replace_symbol(name_path, path, new_body)     — replace existing code via LSP
  insert_code(name_path, path, code, position)  — insert code near a symbol

Do not call Write on source files."
    ;;
esac

exit 0
