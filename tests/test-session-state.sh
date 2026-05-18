#!/usr/bin/env bash
# tests/test-session-state.sh — verify register/unregister maintain
# the session-scoped state dir (.session-bridge/<sid>/ + .current-session-id).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/fixtures.sh
source "$SCRIPT_DIR/lib/fixtures.sh"
# shellcheck source=lib/session-bridge-fixtures.sh
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== session-scoped state =="

# Isolated HOME + a writable cwd.
TEST_HOME="$(mktemp -d)"
CWD="$(mktemp -d)"
SID="state-sid-1"
TP="/home/u/.claude/projects/x/$SID.jsonl"
payload="$(jq -nc \
  --arg sid "$SID" --arg cwd "$CWD" --arg tp "$TP" \
  '{session_id:$sid,cwd:$cwd,transcript_path:$tp,hook_event_name:"SessionStart"}')"

HOME="$TEST_HOME" CLAUDE_CONFIG_DIR="" \
  bash "$SB_HOOK_DIR/register.sh" <<< "$payload" >/dev/null

# register.sh should create <cwd>/.session-bridge/<sid>/ and .current-session-id
[ -d "$CWD/.session-bridge/$SID" ] && pass "per-session dir created" \
  || fail "per-session dir created"
[ "$(cat "$CWD/.session-bridge/.current-session-id" 2>/dev/null)" = "$SID" ] \
  && pass ".current-session-id matches" || fail ".current-session-id matches"

# Simulate the user writing connection.json in /connect-to
echo '{"target_session_id":"other","set_at":1}' > "$CWD/.session-bridge/$SID/connection.json"

# Stop hook for our session should clean up per-session dir + marker, leave parent if empty
stop="$(jq -nc --arg sid "$SID" --arg cwd "$CWD" \
  '{session_id:$sid,cwd:$cwd,hook_event_name:"Stop"}')"
HOME="$TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$stop" >/dev/null

[ ! -d "$CWD/.session-bridge/$SID" ] && pass "per-session dir removed on Stop" \
  || fail "per-session dir removed on Stop"
[ ! -f "$CWD/.session-bridge/.current-session-id" ] && pass ".current-session-id removed" \
  || fail ".current-session-id removed"
[ ! -d "$CWD/.session-bridge" ] && pass ".session-bridge dir removed when empty" \
  || fail ".session-bridge dir removed when empty"

# Two-session scenario: starting session B from same cwd while A is still active
# should not clobber A's state.
SID_A="A-sid"
SID_B="B-sid"
CWD2="$(mktemp -d)"
for s in "$SID_A" "$SID_B"; do
  p="$(jq -nc --arg sid "$s" --arg cwd "$CWD2" --arg tp "/x/$s.jsonl" \
    '{session_id:$sid,cwd:$cwd,transcript_path:$tp,hook_event_name:"SessionStart"}')"
  HOME="$TEST_HOME" CLAUDE_CONFIG_DIR="" \
    bash "$SB_HOOK_DIR/register.sh" <<< "$p" >/dev/null
done

[ -d "$CWD2/.session-bridge/$SID_A" ] && [ -d "$CWD2/.session-bridge/$SID_B" ] \
  && pass "both sessions have own dirs" || fail "both sessions have own dirs"

# Stop B — A's dir must survive.
stop_b="$(jq -nc --arg sid "$SID_B" --arg cwd "$CWD2" \
  '{session_id:$sid,cwd:$cwd,hook_event_name:"Stop"}')"
HOME="$TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$stop_b" >/dev/null

[ -d "$CWD2/.session-bridge/$SID_A" ] && [ ! -d "$CWD2/.session-bridge/$SID_B" ] \
  && pass "stop B leaves A's dir intact" || fail "stop B leaves A's dir intact"

# .current-session-id was last set by B; unregister should drop it because it pointed at B.
[ ! -f "$CWD2/.session-bridge/.current-session-id" ] \
  && pass "marker dropped when it pointed at stopped session" \
  || fail "marker dropped when it pointed at stopped session"

rm -rf "$TEST_HOME" "$CWD" "$CWD2"
print_summary "session-scoped state"
