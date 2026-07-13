#!/bin/bash
# Tests for constitution-brief.sh. Stubs `codescout` the same way
# constitution-guard.test.sh does.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-brief.mjs"
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

assert_has_context() {
  local label="$1" input="$2" expect_present="$3"
  local got ctx
  got=$(echo "$input" | node "$HOOK")
  ctx=$(echo "$got" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
  local present="false"
  [ -n "$ctx" ] && present="true"
  if [ "$present" = "$expect_present" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected additionalContext present=$expect_present, got present=$present (raw: $got)"
  fi
}

mkinput() {
  local sid="$1"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" '{cwd:$cwd, session_id:$sid, prompt:"hi"}'
}

export CS_STUB_RESPONSE='[]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert_has_context "no global rules -> no context" "$(mkinput s1)" "false"

export CS_STUB_RESPONSE='[{"id":"C-2","tracker_id":"t1","title":"Never commit secrets","rule":"R"}]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert_has_context "global rule, first prompt this epoch -> context" "$(mkinput s2)" "true"
assert_has_context "global rule, second prompt same epoch -> no context" "$(mkinput s2)" "false"

echo "== constitution-brief.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
