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
# First blocked call in a 3-second window per (TOOL_NAME, CWD) gets the full reason.
# Subsequent parallel calls get a short "see previous message" to avoid noise.
enforce() {
  local reason="$1"
  local dedup_key
  dedup_key=$(printf '%s\t%s' "$TOOL_NAME" "$CWD" | md5sum | cut -c1-8)
  local dedup_file="/tmp/cs-block-$dedup_key"
  if ! ( set -o noclobber; : > "$dedup_file" ) 2>/dev/null; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED (see previous message)"
      }
    }'
    exit 0
  fi
  ( sleep 3; rm -f "$dedup_file" ) >/dev/null 2>&1 &
  jq -n --arg reason "$reason" '{
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

    # Detect common patterns and give targeted suggestions
    BASH_HINT=""
    if echo "$CMD" | grep -qE '^(grep|rg) '; then
      # grep/ripgrep on source → search_pattern / find_symbol
      BASH_HINT="  search_pattern(\"PATTERN\")             — indexed regex, structured results
  find_symbol(\"NAME\")                   — locate symbol by name (much faster)
  semantic_search(\"CONCEPT\")           — find code by meaning, not just text"
    elif echo "$CMD" | grep -qE '^cat .*\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp)'; then
      # cat on a source file → list_symbols / find_symbol
      SRC_FILE=$(echo "$CMD" | grep -oE '[^ ]+\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp)' | head -1)
      REL_SRC="${SRC_FILE#$CWD/}"
      BASH_HINT="  list_symbols(\"${REL_SRC}\")             — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  find_symbol(name, include_body=true)   — read one specific symbol body"
    elif echo "$CMD" | grep -qE '^find '; then
      # find → find_file
      BASH_HINT="  find_file(\"*.pattern\")                 — indexed file discovery, instant
  find_symbol(\"NAME\")                   — locate a symbol by name across all files"
    else
      BASH_HINT="  run_command(\"${CMD}\")                  — same command with smart summaries + @ref buffers"
    fi

    enforce "WRONG TOOL. You called Bash but codescout is available.

STOP. Do NOT run: ${CMD}

USE codescout tools INSTEAD:
${BASH_HINT}

For other shell commands: run_command(\"COMMAND\") — same execution but:
- Large output stored in @ref buffers (saves THOUSANDS OF TOKENS)
- Bash dumps ALL output into context — WASTING YOUR TOKEN BUDGET
- Buffers are queryable: grep PATTERN @cmd_id, tail -20 @cmd_id

YOU MUST use codescout tools. Do not call Bash."
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

    # If path is under ~/.cargo/registry, the crate is not registered — guide to register_library
    CARGO_HINT=""
    if echo "${PATH_VAL}" | grep -q "\.cargo/registry"; then
      # Extract crate name from path like ~/.cargo/registry/src/index.crates.io-xxx/CRATE-VERSION/
      CRATE_DIR=$(echo "${PATH_VAL}" | grep -oE '.*\.cargo/registry/src/[^/]+/[^/]+' | head -1)
      CRATE_NAME=$(basename "$CRATE_DIR" | sed 's/-[0-9][0-9.]*$//')
      if [ -z "$CRATE_NAME" ]; then
        CRATE_NAME=$(basename "${PATH_VAL}")
      fi
      CARGO_HINT="
NOTE: This path is inside ~/.cargo/registry — the crate '${CRATE_NAME}' is not registered.
Register it first so codescout can index and search it:

  register_library(\"${PATH_VAL}\", name=\"${CRATE_NAME}\")
  find_symbol(\"${PATTERN}\", scope=\"lib:${CRATE_NAME}\")   — search only within this crate
  list_symbols(scope=\"lib:${CRATE_NAME}\")                  — browse crate symbols
"
    fi

    enforce "WRONG TOOL. You called Grep on source files but codescout has a FULL INDEX.

STOP. Do NOT grep source files.
${CARGO_HINT}
Grep scans files line-by-line and dumps raw matches into context — WASTEFUL AND SLOW.
codescout tools use a pre-built index and return STRUCTURED, TOKEN-EFFICIENT results:

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

    # If path is under ~/.cargo/registry, guide toward register_library
    CARGO_HINT=""
    if echo "$FILE_PATH" | grep -q "\.cargo/registry"; then
      CRATE_DIR=$(echo "$FILE_PATH" | grep -oE '.*\.cargo/registry/src/[^/]+/[^/]+' | head -1)
      CRATE_NAME=$(basename "$CRATE_DIR" | sed 's/-[0-9][0-9.]*$//')
      if [ -n "$CRATE_NAME" ] && [ -n "$CRATE_DIR" ]; then
        CARGO_HINT="
NOTE: This file is from crate '${CRATE_NAME}' in ~/.cargo/registry.
Register the crate once, then use symbol tools for all future lookups:

  register_library(\"${CRATE_DIR}\", name=\"${CRATE_NAME}\")   — register crate (do this once)
  list_symbols(scope=\"lib:${CRATE_NAME}\")                     — browse all symbols
  find_symbol(\"SYMBOL\", scope=\"lib:${CRATE_NAME}\")         — find a specific symbol
  goto_definition(path, line)                                   — jump to definition from usage site
"
      fi
    fi

    enforce "WRONG TOOL. You called Read on a source file but codescout has SYMBOL-LEVEL ACCESS.

STOP. Do NOT read: ${FILE_PATH}
${CARGO_HINT}
Reading a full source file WASTES THOUSANDS OF TOKENS. codescout returns ONLY what you need:

  list_symbols(\"${REL_PATH}\")                — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  find_symbol(name, include_body=true)         — ONE symbol body, targeted, token-efficient
  read_file(\"${REL_PATH}\", start_line, end_line) — LAST RESORT only, with explicit line range

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

  replace_symbol(name_path, path, new_body)    — replace a function/struct/class body via LSP
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
