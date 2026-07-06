#!/bin/bash
# Tests for constitution-guard.sh. Stubs the `codescout` binary via PATH so
# this test needs no real build and no real catalog — see
# hooks/il3-deny-hook.test.sh for the black-box invocation style this mirrors.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-guard.sh"
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
  got=$(echo "$input" | "$HOOK")
  decision=$(echo "$got" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
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

echo "== constitution-guard.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
