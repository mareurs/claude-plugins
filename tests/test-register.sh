#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/fixtures.sh
source "$SCRIPT_DIR/lib/fixtures.sh"
# shellcheck source=lib/session-bridge-fixtures.sh
source "$SCRIPT_DIR/lib/session-bridge-fixtures.sh"

echo "== register.sh =="

# Test 1: a simple SessionStart payload creates a registry entry.
payload='{"session_id":"abc-123","cwd":"/tmp/work","transcript_path":"/home/u/.claude/projects/x/abc-123.jsonl","hook_event_name":"SessionStart"}'
sb_run_hook register.sh "$payload" >/dev/null

if sb_registry_has_session "abc-123"; then
  pass "registers session by id"
else
  fail "registers session by id" "no entry written"
fi

# Test 2: fields are populated.
[ "$(sb_registry_field abc-123 cwd)" = "/tmp/work" ] && pass "cwd recorded" || fail "cwd recorded"
[ "$(sb_registry_field abc-123 transcript_path)" = "/home/u/.claude/projects/x/abc-123.jsonl" ] \
  && pass "transcript_path recorded" || fail "transcript_path recorded"
[ -n "$(sb_registry_field abc-123 pid)" ] && pass "pid recorded" || fail "pid recorded"
[ -n "$(sb_registry_field abc-123 started_at)" ] && pass "started_at recorded" || fail "started_at recorded"
[ "$(sb_registry_field abc-123 instance)" = "main" ] && pass "instance=main" || fail "instance=main"

# Test 3: re-registering same id is idempotent (no duplicates).
sb_run_hook register.sh "$payload" >/dev/null
[ "$(sb_session_count)" = "1" ] && pass "idempotent re-register" || fail "idempotent re-register"

sb_cleanup
print_summary "register.sh"
