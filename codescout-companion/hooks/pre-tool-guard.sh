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

# --- Helper: binary images/PDF are the ONLY native-Read exemption ---
# codescout has no renderer for these, so native Read must pass through.
is_binary_image() {
  echo "$1" | grep -qiE '\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$'
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

    # Hardened 2026-05-21: no cross-repo cd-escape. All Bash routes to
    # run_command (which sandboxes cwd to the project). Sibling-repo git
    # uses `git -C /abs/path` from the project root — no cd needed.

    # Detect common patterns and give targeted suggestions
    BASH_HINT=""
    if echo "$CMD" | grep -qE '^(grep|rg) '; then
      # grep/ripgrep on source → search_pattern / symbols
      BASH_HINT="  search_pattern(\"PATTERN\")             — indexed regex, structured results
  symbols(\"NAME\")                       — locate symbol by name (much faster)
  semantic_search(\"CONCEPT\")           — find code by meaning, not just text"
    elif echo "$CMD" | grep -qE '^cat .*\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp|sh|bash)'; then
      # cat on a source file → symbols
      SRC_FILE=$(echo "$CMD" | grep -oE '[^ ]+\.(rs|ts|tsx|js|jsx|py|go|kt|kts|java|cs|rb|swift|cpp|c|h|hpp|sh|bash)' | tee /tmp/codescout-unfiltered-axZboM | head -1)
      REL_SRC="${SRC_FILE#$CWD/}"
      BASH_HINT="  symbols(\"${REL_SRC}\")                  — ALL symbols + line numbers in ~50 tokens (DO THIS FIRST)
  symbols(name, include_body=true)       — read one specific symbol body"
    elif echo "$CMD" | grep -qE '^find '; then
      # find → tree
      BASH_HINT="  tree(\"*.pattern\")                      — indexed file discovery, instant
  symbols(\"NAME\")                       — locate a symbol by name across all files"
    else
      BASH_HINT="  run_command(\"${CMD}\")                  — same command with smart summaries + @ref buffers"
    fi

    enforce "This call is blocked because codescout offers a leaner path for shell work.

Command: ${CMD}

Suggested codescout tools:
${BASH_HINT}

For any other shell command: run_command(\"COMMAND\") — same execution, with:
- Large output stored in @cmd_* buffers (saves context tokens)
- Buffers queryable: grep PATTERN @cmd_id, tail -20 @cmd_id
- Smart summaries returned inline

Cross-repo: run_command sandboxes cwd to the project. For a sibling repo's git,
use run_command(\"git -C /abs/path <subcommand>\") from here — no cd needed."
    ;;

  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    IS_SOURCE=false
    case "$TYPE" in
      kotlin|kt|kts|java|ts|typescript|js|javascript|py|python|go|rust|cs|csharp|rb|ruby|scala|swift|cpp|c|sh)
        IS_SOURCE=true ;;
    esac

    if [ "$IS_SOURCE" = "false" ]; then
      echo "$GLOB" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
      echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
    fi

    : # path-agnostic: every Grep routes to codescout grep/symbols/semantic_search

    # If path is under ~/.cargo/registry, the crate is not registered — guide to library
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

  library(\"${PATH_VAL}\", name=\"${CRATE_NAME}\")
  symbols(\"${PATTERN}\", scope=\"lib:${CRATE_NAME}\")   — search only within this crate
  symbols(scope=\"lib:${CRATE_NAME}\")                   — browse crate symbols
"
    fi

    enforce "This call is blocked because codescout has a pre-built index for source files.
${CARGO_HINT}
Native Grep scans files line-by-line and dumps raw matches into context.
codescout uses the index and returns structured, token-efficient results:

  grep(\"${PATTERN}\")              — regex search, returns matching lines with optional context_lines
  symbols(\"${PATTERN}\")           — locate symbol by name (faster than text search)
  semantic_search(\"${PATTERN}\")   — concept-level search when the name is unknown"
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    BASENAME="${PATTERN##*/}"
    # path-agnostic: every Glob routes to codescout tree

    enforce "This call is blocked because codescout has an indexed file lister.

codescout already knows every file in the project. Use the index directly:

  tree(\"${PATTERN}\")             — glob-style file discovery via codescout index
  symbols(\"${BASENAME%.*}\")      — find a symbol by name if you know what you are after"
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_binary_image "$FILE_PATH" && exit 0

    # Relative path when under CWD; absolute (cross-repo) otherwise — both work for codescout.
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    if echo "$FILE_PATH" | grep -qiE '\.md$'; then
      enforce "This call is blocked because codescout has heading-aware markdown reading.

File: ${FILE_PATH}

Reading a full markdown file dumps everything into context. read_markdown is size-adaptive (full content for small files, heading map + slice recipe for large):

  read_markdown(\"${REL_PATH}\")                            — adaptive output (start here)
  read_markdown(\"${REL_PATH}\", heading=\"## Section\")      — one section
  read_markdown(\"${REL_PATH}\", headings=[\"## A\", \"## B\"]) — multiple sections
  grep(\"pattern\", path=\"${REL_PATH}\")                     — content search

read_markdown works on absolute cross-repo paths too. Native Read of markdown is blocked regardless of which repo the file lives in."
    fi

    if echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN"; then
      CARGO_HINT=""
      if echo "$FILE_PATH" | grep -q "\.cargo/registry"; then
        CRATE_DIR=$(echo "$FILE_PATH" | grep -oE '.*\.cargo/registry/src/[^/]+/[^/]+' | head -1)
        CRATE_NAME=$(basename "$CRATE_DIR" | sed 's/-[0-9][0-9.]*$//')
        if [ -n "$CRATE_NAME" ] && [ -n "$CRATE_DIR" ]; then
          CARGO_HINT="
NOTE: This file is from crate '${CRATE_NAME}' in ~/.cargo/registry.
Register the crate once, then use symbol tools for all future lookups:

  library(\"${CRATE_DIR}\", name=\"${CRATE_NAME}\")   — register crate (do this once)
  symbols(scope=\"lib:${CRATE_NAME}\")                — browse all symbols
  symbols(\"SYMBOL\", scope=\"lib:${CRATE_NAME}\")   — find a specific symbol
  symbol_at(path, line)                              — jump to definition from usage site
"
        fi
      fi
      enforce "This call is blocked because codescout has a faster path for source files.

File: ${FILE_PATH}
${CARGO_HINT}
Reading a full source file costs thousands of tokens. codescout returns just what you need:

  symbols(\"${REL_PATH}\")                      — overview + line numbers (~50 tokens)
  symbols(name, include_body=true)             — one symbol body, targeted
  read_file(\"${REL_PATH}\", start_line, end_line) — only when symbol tools cannot reach it

Suggested flow: symbols first → symbols(name, include_body=true) for specific code → read_file with an explicit range only as last resort."
    fi

    # Any other text file → read_file (tracked, buffer-aware). Structured hint for json/toml/yaml.
    STRUCT_HINT=""
    if echo "$FILE_PATH" | grep -qiE '\.json$'; then
      STRUCT_HINT="
  read_file(\"${REL_PATH}\", json_path=\"\$.key\")    — extract a JSON subtree"
    elif echo "$FILE_PATH" | grep -qiE '\.(toml|ya?ml)$'; then
      STRUCT_HINT="
  read_file(\"${REL_PATH}\", toml_key=\"section\")     — extract a TOML/YAML section"
    fi
    enforce "This call is blocked because codescout reads files through its tracked, buffer-aware reader.

File: ${FILE_PATH}

  read_file(\"${REL_PATH}\")                      — full content; large output stored as an @file_* buffer${STRUCT_HINT}

read_file works on absolute cross-repo paths. Only binary images/PDF are exempt from this block (codescout has no renderer)."
    ;;

  Edit)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_binary_image "$FILE_PATH" && exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's edit_code is the safer path for structural source edits.

File: ${FILE_PATH}

The native Edit tool bypasses codescout's LSP awareness and safety gates.
codescout offers structural, LSP-backed editing via edit_code:

  edit_code(symbol, path, action=\"replace\", body=...)               — replace a function/struct/class body
  edit_code(symbol, path, action=\"insert\", position=\"before\"|\"after\", body=...) — inject near a symbol
  edit_code(symbol, path, action=\"remove\")                          — delete a symbol
  edit_code(symbol, path, action=\"rename\", new_name=...)            — project-wide rename via LSP
  edit_file(path, old_string, new_string)                            — imports, literals, comments, config (not structural code)

Suggested flow: symbols(name, include_body=true) to inspect the current body → edit_code to change it."
    ;;

  Write)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

    is_binary_image "$FILE_PATH" && exit 0

    # Extract relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    enforce "This call is blocked because codescout's create_file is the tracked path for new source files.

File: ${FILE_PATH}

The native Write tool bypasses codescout's safety gates and file tracking.
codescout alternatives:

  create_file(path, content)                                 — create or overwrite (tracked by codescout)
  edit_code(symbol, path, action=\"replace\", body=...)        — replace an existing symbol body via LSP
  edit_code(symbol, path, action=\"insert\", position=..., body=...) — insert code near a symbol"
    ;;
esac

exit 0
