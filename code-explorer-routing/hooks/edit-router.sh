#!/bin/bash
# PreToolUse hook — redirect replace_content on source files to edit_lines or symbol tools
# Only blocks when the tool belongs to the code-explorer MCP server.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# Only block code-explorer's replace_content, not other tools matching the substring
EXPECTED_TOOL="mcp__${CE_SERVER_NAME}__replace_content"
[ "$TOOL_NAME" != "$EXPECTED_TOOL" ] && exit 0

# Check if target is a source file
PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

# Extract relative path for suggestion
REL_PATH="$PATH_VAL"
if [[ "$PATH_VAL" == "$CWD"* ]]; then
  REL_PATH="${PATH_VAL#$CWD/}"
fi

jq -n --arg reason "BLOCKED: For code files, use symbol-aware or line-based editing:
  replace_symbol_body(name_path, \"${REL_PATH}\", new_body) — replace entire symbol
  edit_lines(\"${REL_PATH}\", start_line, delete_count, new_text) — splice by line number
  insert_before_symbol / insert_after_symbol — add code at symbol boundaries

replace_content is for non-code files (.md, .json, .toml, .yaml) only." '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
