#!/usr/bin/env bash
# Test session-start.sh: pointer + by-ppid + GC + dead file removal.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/session-start.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
EVENT='{"session_id":"sid-aaa","cwd":"'"$WORK"'","source":"startup","timestamp":1700000000}'

echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ -f "$WORK/.buddy/.current_session_id" ] && [ "$(cat "$WORK/.buddy/.current_session_id")" = "sid-aaa" ] \
  && pass "pointer file written" || fail "pointer file"

[ -f "$WORK/.buddy/by-ppid/$$/session_id" ] && [ "$(cat "$WORK/.buddy/by-ppid/$$/session_id")" = "sid-aaa" ] \
  && pass "by-ppid session_id written" || fail "by-ppid session_id"

[ -f "$WORK/.buddy/by-ppid/$$/started_at" ] && [ -s "$WORK/.buddy/by-ppid/$$/started_at" ] \
  && pass "by-ppid started_at written" || fail "by-ppid started_at"

# GC: seed a stale by-ppid entry with bogus pid + bogus started_at
mkdir -p "$WORK/.buddy/by-ppid/99999"
echo "stale-sid" > "$WORK/.buddy/by-ppid/99999/session_id"
echo "BOGUS_TIME" > "$WORK/.buddy/by-ppid/99999/started_at"

EVENT2='{"session_id":"sid-bbb","cwd":"'"$WORK"'","source":"resume","timestamp":1700001000}'
echo "$EVENT2" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -d "$WORK/.buddy/by-ppid/99999" ] \
  && pass "GC removed stale entry" || fail "GC stale entry — still exists"

# Dead file cleanup: seed and verify removal
mkdir -p "$HOME/.claude/buddy"
DEAD="$HOME/.claude/buddy/state.json"
DEAD_BACKUP=""
if [ -f "$DEAD" ]; then DEAD_BACKUP=$(mktemp); cp "$DEAD" "$DEAD_BACKUP"; fi
echo '{"version":1}' > "$DEAD"

EVENT3='{"session_id":"sid-ccc","cwd":"'"$WORK"'","source":"startup","timestamp":1700002000}'
echo "$EVENT3" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -f "$DEAD" ] && pass "dead global state.json removed" || fail "dead global state.json still exists"

# Restore if we backed up the user's real one
if [ -n "$DEAD_BACKUP" ]; then mv "$DEAD_BACKUP" "$DEAD"; fi

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
