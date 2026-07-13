#!/bin/bash
# Tests for constitution-guard.sh. Stubs the `codescout` binary via PATH so
# this test needs no real build and no real catalog — see
# hooks/il3-deny-hook.test.sh for the black-box invocation style this mirrors.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-guard.mjs"
PASS=0
FAIL=0

STUB_DIR=$(mktemp -d)
cat > "$STUB_DIR/codescout" <<'EOF'
#!/bin/bash
echo "${CS_STUB_RESPONSE:-[]}"
EOF
chmod +x "$STUB_DIR/codescout"
export PATH="$STUB_DIR:$PATH"

PROJECT=$(mktemp -d)

assert() {
  local label="$1" input="$2" expected_decision="$3"
  local got decision
  got=$(echo "$input" | node "$HOOK")
  if [ -z "$got" ]; then
    decision="allow"
  else
    decision=$(echo "$got" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
    [ -z "$decision" ] && decision="allow"
  fi
  if [ "$decision" = "$expected_decision" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected $expected_decision, got $decision (raw: $got)"
  fi
}

mkinput() {
  local sid="$1" path="$2"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" --arg p "$path" \
    '{tool_name:"Edit", cwd:$cwd, session_id:$sid, tool_input:{file_path:$p}}'
}

export CS_STUB_RESPONSE='[]'
assert "no matches -> allow" "$(mkinput s1 src/x.kt)" "allow"

export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t1","title":"T","rule":"R"}]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert "unseen match -> deny" "$(mkinput s2 src/solver/x.kt)" "deny"
assert "same session, same rule, second touch -> allow" "$(mkinput s2 src/solver/y.kt)" "allow"
assert "different session -> deny again (not seen in THIS session)" "$(mkinput s3 src/solver/x.kt)" "deny"

assert "missing session_id -> allow" "$(jq -n --arg cwd "$PROJECT" --arg p "src/solver/x.kt" '{tool_name:"Edit", cwd:$cwd, tool_input:{file_path:$p}}')" "allow"

seed_state() {
  local sid="$1" content="$2"
  mkdir -p "$PROJECT/.codescout/constitution-seen"
  printf '%s' "$content" > "$PROJECT/.codescout/constitution-seen/$sid.json"
}

export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t1","title":"T","rule":"R"}]'
rm -rf "$PROJECT/.codescout/constitution-seen"
seed_state s6 'not valid json'
assert "corrupt state file -> deny (recovers, does not crash/hang)" "$(mkinput s6 src/solver/x.kt)" "deny"
assert "corrupt state healed, second touch same session -> allow" "$(mkinput s6 src/solver/x.kt)" "allow"

rm -rf "$PROJECT/.codescout/constitution-seen"
export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t1","title":"T1","rule":"R1"}]'
assert "tracker t1's C-1 -> deny (first time)" "$(mkinput s7 src/solver/x.kt)" "deny"

export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t2","title":"T2","rule":"R2"}]'
assert "tracker t2's distinct C-1 (same session) -> deny (not deduped against t1's C-1)" "$(mkinput s7 src/solver/x.kt)" "deny"

export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t2","title":"T2","rule":"R2"}]'
assert "same tracker_id/id pair, new session -> deny again (session isolation preserved)" "$(mkinput s5 src/solver/x.kt)" "deny"

echo "== constitution-guard.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
