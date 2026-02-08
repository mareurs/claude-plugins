#!/usr/bin/env bash
set -euo pipefail

# SDD PreToolUse hook: ensure constitutional review before git commit

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process Bash tool calls
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Determine project directory
PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_DIR="${PROJECT_DIR:-${CWD:-$PWD}}"

# Check if project has SDD (constitution.md must exist)
if [[ ! -f "$PROJECT_DIR/memory/constitution.md" ]]; then
  exit 0
fi

# Check if this is a git commit command
if [[ "$COMMAND" != *"git commit"* ]]; then
  exit 0
fi

# Generate project hash
HASH=$(echo -n "$PROJECT_DIR" | md5sum | cut -c1-8)

# Check for review marker
MARKER="/tmp/.sdd-reviewed-$HASH"
if [[ -f "$MARKER" ]]; then
  exit 0
fi

# No review marker found - check enforcement level
ENFORCEMENT="warn"
CONFIG_FILE="$PROJECT_DIR/memory/sdd-config.md"
if [[ -f "$CONFIG_FILE" ]]; then
  PARSED=$(sed -n '/^---$/,/^---$/p' "$CONFIG_FILE" | grep -E '^enforcement:' | head -1 | sed 's/^enforcement:[[:space:]]*//' || true)
  if [[ -n "$PARSED" ]]; then
    ENFORCEMENT="$PARSED"
  fi
fi

WARNING_MSG="Constitutional review not performed this session. Run /review before committing. (Article III: Constitutional Review Before Commit)"

if [[ "$ENFORCEMENT" == "strict" ]]; then
  jq -n --arg msg "$WARNING_MSG" '{permissionDecision: "deny", message: $msg}'
else
  jq -n --arg msg "$WARNING_MSG" '{additionalContext: $msg}'
fi
