#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/fixtures.sh"
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== concurrent register =="

SB_TEST_HOME="$(mktemp -d)"
SB_TEST_REGISTRY="$SB_TEST_HOME/.claude/sessions/active.json"

# Fire 20 register.sh in parallel with distinct session ids.
for i in $(seq 1 20); do
  payload=$(jq -nc --arg i "$i" \
    '{session_id:("p-"+$i),cwd:"/tmp",transcript_path:("/home/u/.claude/projects/x/p-"+$i+".jsonl"),hook_event_name:"SessionStart"}')
  HOME="$SB_TEST_HOME" CLAUDE_CONFIG_DIR="" \
    bash "$SB_HOOK_DIR/register.sh" <<< "$payload" &
done
wait

count="$(sb_session_count)"
[ "$count" = "20" ] && pass "20 parallel registers all land" || fail "20 parallel registers" "got $count"

# Registry is still valid JSON (no torn writes).
jq -e . "$SB_TEST_REGISTRY" >/dev/null 2>&1 && pass "registry is valid JSON" || fail "registry is valid JSON"

rm -rf "$SB_TEST_HOME"
print_summary "concurrent register"
