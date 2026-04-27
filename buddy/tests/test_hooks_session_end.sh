#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/session-end.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# Seed a by-ppid entry for our own PPID
mkdir -p "$WORK/.buddy/by-ppid/$$"
echo "sid-end-test" > "$WORK/.buddy/by-ppid/$$/session_id"
echo "TIME" > "$WORK/.buddy/by-ppid/$$/started_at"

EVENT='{"cwd":"'"$WORK"'","session_id":"sid-end-test"}'
echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -d "$WORK/.buddy/by-ppid/$$" ] \
  && pass "by-ppid entry for own PPID removed" || fail "by-ppid entry not removed"

# Seed an entry for a different PPID — must NOT be touched
mkdir -p "$WORK/.buddy/by-ppid/77777"
echo "other" > "$WORK/.buddy/by-ppid/77777/session_id"
echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true
[ -d "$WORK/.buddy/by-ppid/77777" ] \
  && pass "other PPID entries untouched" || fail "other PPID was wrongly removed"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
