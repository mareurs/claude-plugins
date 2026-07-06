#!/bin/bash
# UserPromptSubmit hook — surfaces global (path-less) constitution rules
# once per epoch via additionalContext. Path-scoped rules are a different
# channel (constitution-guard.sh, PreToolUse) — this hook only ever calls
# `codescout constitution-check` WITHOUT --path.
#
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo) for the full design.

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

CS_BIN=$(command -v codescout 2>/dev/null) || exit 0
[ -z "$CS_BIN" ] && exit 0

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR" 2>/dev/null
[ -f "$STATE_FILE" ] || echo '{"epoch":0,"seen_path_rules":[],"global_surfaced_epoch":-1}' > "$STATE_FILE"
STATE=$(cat "$STATE_FILE")

EPOCH=$(echo "$STATE" | jq '.epoch')
SURFACED_EPOCH=$(echo "$STATE" | jq '.global_surfaced_epoch')
[ "$EPOCH" = "$SURFACED_EPOCH" ] && exit 0

RULES=$("$CS_BIN" constitution-check --project "$CWD" 2>/dev/null)
echo "$RULES" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1 || exit 0

DIGEST=$(echo "$RULES" | jq -r 'map("[\(.id)] \(.title)\n\(.rule)") | join("\n\n")')

NEW_STATE=$(echo "$STATE" | jq --argjson e "$EPOCH" '. * {global_surfaced_epoch: $e}')
echo "$NEW_STATE" > "$STATE_FILE"

jq -n --arg body "$DIGEST" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: ("Constitution rules — must follow no matter what:\n\n" + $body)
  }
}'
exit 0
