#!/usr/bin/env bash
set -euo pipefail

# SDD PreToolUse Hook: Spec Guard
# Warns or blocks source code writes when no specifications exist.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only process Write and Edit
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Determine project directory
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
CWD="${CWD:-${CWD_ENV:-$PWD}}"

# Check if project has SDD (constitution.md must exist)
if [[ ! -f "$CWD/memory/constitution.md" ]]; then
  exit 0
fi

# Allow non-source-code paths
case "$FILE_PATH" in
  */memory/*|*/.claude/*|*/docs/*|*/.serena/*|*/.claude-plugin/*)
    exit 0
    ;;
esac

case "$FILE_PATH" in
  *.md|*.json|*.yaml|*.yml|*.toml|*.cfg|*.ini|*.gitignore|*.env)
    exit 0
    ;;
esac

# Check if any specs exist
if ls "$CWD"/memory/specs/*.md 2>/dev/null | grep -q .; then
  exit 0
fi

# No specs and writing source code -- enforce policy
ENFORCEMENT="warn"
if [[ -f "$CWD/memory/sdd-config.md" ]]; then
  PARSED=$(sed -n '/^---$/,/^---$/p' "$CWD/memory/sdd-config.md" | grep -E '^enforcement:' | head -1 | sed 's/^enforcement:[[:space:]]*//' | tr -d '"' | tr -d "'" || true)
  if [[ -n "$PARSED" ]]; then
    ENFORCEMENT="$PARSED"
  fi
fi

WARNING="No specifications found in memory/specs/. Consider running /specify <feature> before writing code. (Article I: Specification-First Development)"

if [[ "$ENFORCEMENT" == "strict" ]]; then
  jq -n --arg reason "$WARNING" '{permissionDecision: "deny", permissionDecisionReason: $reason}'
else
  jq -n --arg msg "$WARNING" '{additionalContext: $msg}'
fi
