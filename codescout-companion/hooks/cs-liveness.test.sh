#!/usr/bin/env bash
# Test for cs-liveness.mjs's rendezvous liveness stamp.
#
# The stamp is INSTRUMENTATION: it must record proof-of-life without changing
# any server behaviour. Two invariants carry that, and case 2 is the one that
# matters most — the server reads a non-null `hook_at` as "a companion is
# present", so stamping an unstamped slot would flip that session from the
# blunt-clear path onto the surgical one. Measured 2026-08-27: 3 of 7 live slots
# were unstamped, so that population is real.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/cs-liveness.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
SLOTS="$TMP/codescout/servers"; mkdir -p "$SLOTS"

write_slot() { # file ppid hook_at_iso_or_null session
  python3 -c "
import json,sys
f,ppid,hook,sess=sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4]
json.dump({'pid':999999,'ppid':ppid,'started_at':'2026-01-01T00:00:00Z',
           'cwd':'/tmp','session':sess,
           'hook_at':(None if hook=='null' else hook)}, open(f,'w'))
" "$1" "$2" "$3" "$4"
}
field() { python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2]))" "$1" "$2"; }

run_hook() {
  echo '{"session_id":"conv-test","tool_name":"mcp__codescout__symbols"}' \
    | XDG_STATE_HOME="$TMP" node "$HOOK" >/dev/null 2>&1
}

OLD="2026-01-01T00:00:00.000Z"
NOW_ISO="$(python3 -c 'import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"))')"

# 1. A stale stamp on our own slot is refreshed.
write_slot "$SLOTS/mine.json" "$$" "$OLD" "conv-A"
# 2. An UNSTAMPED slot must stay unstamped — never open the gate.
write_slot "$SLOTS/unstamped.json" "$$" "null" "conv-A"
# 3. A fresh stamp is left alone (throttle).
write_slot "$SLOTS/fresh.json" "$$" "$NOW_ISO" "conv-A"
# 4. Another process's slot is not ours to touch.
write_slot "$SLOTS/foreign.json" 1 "$OLD" "conv-B"

run_hook

got=$(field "$SLOTS/mine.json" hook_at)
[ "$got" != "$OLD" ] && [ "$got" != "None" ] \
  && pass "a stale stamp is refreshed" \
  || fail "a stale stamp is refreshed" "hook_at still $got"

got=$(field "$SLOTS/unstamped.json" hook_at)
[ "$got" = "None" ] \
  && pass "an unstamped slot stays unstamped (the gate is never opened here)" \
  || fail "an unstamped slot stays unstamped" "hook_at became $got"

got=$(field "$SLOTS/fresh.json" hook_at)
[ "$got" = "$NOW_ISO" ] \
  && pass "a fresh stamp is not rewritten (throttle holds)" \
  || fail "a fresh stamp is not rewritten" "hook_at moved to $got"

got=$(field "$SLOTS/foreign.json" hook_at)
[ "$got" = "$OLD" ] \
  && pass "a slot outside our ancestry is untouched" \
  || fail "a slot outside our ancestry is untouched" "hook_at became $got"

got=$(field "$SLOTS/mine.json" session)
[ "$got" = "conv-A" ] \
  && pass "session is never rewritten (this measures, it does not fix)" \
  || fail "session is never rewritten" "session became $got"

echo; echo "cs-liveness: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
