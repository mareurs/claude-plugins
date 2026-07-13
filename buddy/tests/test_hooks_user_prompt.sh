#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DISPATCH="$PLUGIN_ROOT/hooks/hook_dispatch.py"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
SID="sid-prompt-test"
EVENT='{"session_id":"'"$SID"'","cwd":"'"$WORK"'","timestamp":1700000000}'

echo "$EVENT" | python3 "$DISPATCH" user-prompt-submit >/dev/null 2>&1 || true

[ -f "$WORK/.buddy/.current_session_id" ] && [ "$(cat "$WORK/.buddy/.current_session_id")" = "$SID" ] \
  && pass "pointer written" || fail "pointer"

[ -f "$WORK/.buddy/by-ppid/$$/session_id" ] && [ "$(cat "$WORK/.buddy/by-ppid/$$/session_id")" = "$SID" ] \
  && pass "by-ppid session_id" || fail "by-ppid session_id"

[ -f "$WORK/.buddy/by-ppid/$$/started_at" ] && [ -s "$WORK/.buddy/by-ppid/$$/started_at" ] \
  && pass "by-ppid started_at" || fail "by-ppid started_at"

[ -f "$WORK/.buddy/$SID/state.json" ] \
  && pass "session-scoped state.json written" || fail "state.json not at session path"

# --- summon bootstrap (2026-06-12 skill-loading bootstrap; A2 spill 2026-06-14) ---
# Builtin specialist resolved via the real plugin skills/. The payload is too
# large to inline (CC truncates large hook stdout), so the hook spills it to the
# guard-exempt .buddy/<sid>/ tree and emits a compact pointer on stdout.
SUMMON_EVENT='{"session_id":"'"$SID"'","cwd":"'"$WORK"'","timestamp":1700000001,"prompt":"/buddy:summon debugging-yeti"}'
SUMMON_OUT=$(BUDDY_HOME="$WORK/bh" bash -c "echo '$SUMMON_EVENT' | python3 '$DISPATCH' user-prompt-submit" 2>/dev/null || true)
echo "$SUMMON_OUT" | grep -q "buddy:summon-payload specialist=debugging-yeti" \
  && pass "summon prompt → payload marker on stdout" || fail "summon payload marker missing"
echo "$SUMMON_OUT" | grep -q "payload-file=.buddy/$SID/summon-payload-debugging-yeti.md" \
  && pass "pointer carries payload-file path" || fail "payload-file pointer missing"
SPILL="$WORK/.buddy/$SID/summon-payload-debugging-yeti.md"
{ [ -f "$SPILL" ] && grep -q "## Gates" "$SPILL"; } \
  && pass "spilled payload carries gates" || fail "gates missing from spilled payload"
grep -q '"debugging-yeti"' "$WORK/.buddy/$SID/state.json" \
  && pass "summon tracked hook-side in state.json" || fail "active_specialists not updated"

# Second summon of the same specialist → already-active marker, no payload.
SUMMON_OUT2=$(BUDDY_HOME="$WORK/bh" bash -c "echo '$SUMMON_EVENT' | python3 '$DISPATCH' user-prompt-submit" 2>/dev/null || true)
echo "$SUMMON_OUT2" | grep -q "buddy:summon-already-active" \
  && pass "repeat summon → already-active marker" || fail "dedup marker missing"

# Non-summon prompt → no payload markers in output.
PLAIN_OUT=$(echo "$EVENT" | python3 "$DISPATCH" user-prompt-submit 2>/dev/null || true)
echo "$PLAIN_OUT" | grep -q "buddy:summon" \
  && fail "plain prompt leaked summon output" || pass "plain prompt → no summon output"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
