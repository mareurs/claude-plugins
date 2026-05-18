#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/fixtures.sh"
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== unregister.sh =="

# Register first, then unregister.
reg='{"session_id":"id-1","cwd":"/tmp/a","transcript_path":"/home/u/.claude/projects/x/id-1.jsonl","hook_event_name":"SessionStart"}'
sb_run_hook register.sh "$reg" >/dev/null
sb_registry_has_session "id-1" || { fail "precondition: registered"; print_summary "unregister.sh"; exit 1; }

stop='{"session_id":"id-1","hook_event_name":"Stop","stop_hook_active":false}'
HOME="$SB_TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$stop" >/dev/null

sb_registry_has_session "id-1" && fail "removes entry by id" || pass "removes entry by id"
[ "$(sb_session_count)" = "0" ] && pass "session count is 0" || fail "session count is 0"

# Unregistering an unknown id is a no-op (exit 0, no error).
unknown='{"session_id":"does-not-exist","hook_event_name":"Stop"}'
HOME="$SB_TEST_HOME" bash "$SB_HOOK_DIR/unregister.sh" <<< "$unknown"; rc=$?
[ "$rc" = "0" ] && pass "unknown id exits 0" || fail "unknown id exits 0"

sb_cleanup
print_summary "unregister.sh"
