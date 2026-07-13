#!/usr/bin/env bash
# Emission tests for the skill-hint hooks (pre-task-hint.mjs, pre-edit-hint.mjs):
# the detectFor() codescout gate + session-scoped emitSkillHint dedup.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
pass() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
fail() { echo "FAIL [$1]: $2"; FAIL=$((FAIL + 1)); }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "want '$2' got: $3" ;; esac; }
empty() { if [ -z "$2" ]; then pass "$1"; else fail "$1" "want empty got: $2"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# codescout-active cwd: .mcp.json declares a codescout server.
CS="$TMP/proj"
mkdir -p "$CS"
cat > "$CS/.mcp.json" <<'JSON'
{ "mcpServers": { "codescout": { "command": "/x/codescout" } } }
JSON
SID="testsid"

inp() { jq -nc --arg c "$1" --arg s "$2" --arg t "$3" \
  '{tool_name:$t, cwd:$c, session_id:$s, tool_input:{prompt:"x"}}'; }

# pre-task-hint: first Agent dispatch → fires; second → dedup {}
has "pre-task first fire"  "Reconnaissance recommended" "$(inp "$CS" "$SID" "Agent" | node "$HERE/pre-task-hint.mjs")"
has "pre-task dedup {}"    "{}"                          "$(inp "$CS" "$SID" "Agent" | node "$HERE/pre-task-hint.mjs")"

# pre-edit-hint: independent topic → fires; second → dedup {}
has "pre-edit first fire"  "shape-changing edit" "$(inp "$CS" "$SID" "mcp__codescout__edit_code" | node "$HERE/pre-edit-hint.mjs")"
has "pre-edit dedup {}"    "{}"                  "$(inp "$CS" "$SID" "mcp__codescout__edit_code" | node "$HERE/pre-edit-hint.mjs")"

# non-codescout cwd (empty HOME, no CLAUDE_CONFIG_DIR, no .mcp.json) → silent
BARE="$TMP/bare"
mkdir -p "$BARE"
out="$(inp "$BARE" "sid2" "Agent" | env -u CLAUDE_CONFIG_DIR HOME="$TMP/emptyhome" node "$HERE/pre-task-hint.mjs")"
empty "pre-task non-codescout → silent" "$out"

# no session_id → {} even when codescout-active (no marker path)
has "pre-task no-session → {}" "{}" "$(inp "$CS" "" "Agent" | node "$HERE/pre-task-hint.mjs")"

echo "---"
echo "Total: $((PASS + FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -eq 0 ]
