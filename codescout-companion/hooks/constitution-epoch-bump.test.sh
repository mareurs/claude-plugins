#!/bin/bash
# Tests for constitution-epoch-bump.sh — pure state-file mutation, no
# codescout binary involved.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-epoch-bump.mjs"
PASS=0
FAIL=0

PROJECT=$(mktemp -d)
STATE_DIR="$PROJECT/.codescout/constitution-seen"
mkdir -p "$STATE_DIR"

assert_eq() {
  local label="$1" got="$2" expected="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected '$expected', got '$got'"
  fi
}

mkinput() {
  local sid="$1"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" '{cwd:$cwd, session_id:$sid}'
}

# No state file yet -> no-op, no crash.
echo "$(mkinput s1)" | node "$HOOK"
assert_eq "no state file -> none created" "$([ -f "$STATE_DIR/s1.json" ] && echo yes || echo no)" "no"

# Existing state -> epoch increments, seen_path_rules clears, global_surfaced_epoch untouched.
echo '{"epoch":2,"seen_path_rules":["C-1","C-2"],"global_surfaced_epoch":2}' > "$STATE_DIR/s2.json"
echo "$(mkinput s2)" | node "$HOOK"
NEW=$(cat "$STATE_DIR/s2.json")
assert_eq "epoch incremented" "$(echo "$NEW" | jq '.epoch')" "3"
assert_eq "seen_path_rules cleared" "$(echo "$NEW" | jq -c '.seen_path_rules')" "[]"
assert_eq "global_surfaced_epoch untouched" "$(echo "$NEW" | jq '.global_surfaced_epoch')" "2"

echo "== constitution-epoch-bump.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
