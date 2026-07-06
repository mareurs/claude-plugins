#!/bin/bash
# PreToolUse hook — enforces path-scoped constitution rules via a one-time-
# per-epoch deny. A "constitution" tracker (codescout kind=tracker, tagged
# "constitution") holds rules the agent must follow no matter what. The
# first time a tool touches a matching path this epoch, the call is denied
# with the rule's text as the reason — the channel proven to actually reach
# the model (a denied call's reason comes back as content the model reads).
# Subsequent touches in the same epoch are allowed silently.
# constitution-epoch-bump.sh (PreCompact) resets exposure after a
# compaction, since the model's effective context may no longer contain a
# rule it "already saw" pre-compaction.
#
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo) for the full design.

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TARGET_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // .tool_input.file_path // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$TARGET_PATH" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

CS_BIN=$(command -v codescout 2>/dev/null) || exit 0
[ -z "$CS_BIN" ] && exit 0

MATCHES=$("$CS_BIN" constitution-check --path "$TARGET_PATH" --project "$CWD" 2>/dev/null)
echo "$MATCHES" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1 || exit 0

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR" 2>/dev/null
[ -f "$STATE_FILE" ] || echo '{"epoch":0,"seen_path_rules":[],"global_surfaced_epoch":-1}' > "$STATE_FILE"
STATE=$(cat "$STATE_FILE")

UNSEEN=$(jq -n --argjson matches "$MATCHES" --argjson state "$STATE" \
  '$matches | map(select(.id as $id | ($state.seen_path_rules | index($id)) == null))')

[ "$(echo "$UNSEEN" | jq 'length')" -eq 0 ] && exit 0

REASON=$(echo "$UNSEEN" | jq -r 'map("[\(.id)] \(.title)\n\(.rule)") | join("\n\n")')

NEW_STATE=$(jq -n --argjson state "$STATE" --argjson unseen "$UNSEEN" \
  '$state * {seen_path_rules: ($state.seen_path_rules + ($unseen | map(.id)))}')
echo "$NEW_STATE" > "$STATE_FILE"

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
