#!/bin/bash
# PreToolUse hook — redirect Grep/Glob/Read on source files to code-explorer tools
# Pass-through for non-code files and when code-explorer is not configured.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# Redirect messages
GREP_MSG="BLOCKED: Use code-explorer for source file search:
- search_for_pattern(pattern, path)               — regex/literal across source
- find_symbol(pattern, relative_path)             — find a class/function by name
- find_referencing_symbols(name_path, file)       — find all callers/usages
- semantic_search(\"concept\")                      — find code by meaning"

GLOB_MSG="BLOCKED: Use code-explorer for source file discovery:
- find_file(\"**/*.ext\")                           — glob file discovery
- find_symbol(pattern, relative_path)             — find symbol by name"

READ_MSG="BLOCKED: Use code-explorer to read source files efficiently:
- get_symbols_overview(file)                      — see all symbols first
- find_symbol(pattern, include_body=true)         — read a specific symbol
- list_functions(file)                            — quick function list (offline)
- read_file(path, start_line, end_line)           — if you must read a section

If you need the full file, use Read with an explicit limit (e.g. limit: 2000)."

case "$TOOL_NAME" in
  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')

    IS_SOURCE=false
    case "$TYPE" in
      kotlin|kt|kts|java|ts|typescript|js|javascript|py|python|go|rust|cs|csharp|rb|ruby|scala|swift|cpp|c)
        IS_SOURCE=true ;;
    esac

    if [ "$IS_SOURCE" = "false" ]; then
      echo "$GLOB" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
      echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
    fi

    if [ "$IS_SOURCE" = "true" ]; then
      jq -n --arg reason "$GREP_MSG" '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
    fi
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    if ! echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN"; then
      exit 0
    fi

    BASENAME="${PATTERN##*/}"

    # Allow broad wildcard scans (e.g. **/*.ts for discovery)
    if [[ "$BASENAME" == "*."* ]]; then
      exit 0
    fi

    # Block specific named file lookups: uppercase-start (e.g. ClassName.ts) or
    # non-wildcard basename (e.g. main.ts). Partial wildcards (*foo.ts) pass through —
    # they are unusual discovery patterns that don't warrant blocking.
    if [[ "$BASENAME" =~ ^[A-Z] ]] || [[ "$BASENAME" != "*"* ]]; then
      jq -n --arg reason "$GLOB_MSG" '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
    fi
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')
    OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')

    if ! echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN"; then
      exit 0
    fi

    # Allow targeted reads (explicit limit or offset = intentional)
    if [ -n "$LIMIT" ] || [ -n "$OFFSET" ]; then
      exit 0
    fi

    jq -n --arg reason "$READ_MSG" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
    ;;
esac

exit 0
