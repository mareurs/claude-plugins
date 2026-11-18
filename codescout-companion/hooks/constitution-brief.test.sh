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

# --- binary resolution off PATH (docs/issues/2026-11-05-constitution-hooks-cannot-find-codescout-binary.md)
NODE_BIN=$(command -v node)
MIN_PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin"
if PATH="$MIN_PATH" command -v codescout >/dev/null 2>&1; then
  FAIL=$((FAIL+1))
  echo "FAIL: precondition — codescout is resolvable on the minimal PATH ($MIN_PATH); off-PATH cases would be vacuous"
else
  FAKE_HOME=$(mktemp -d)
  EMPTY_HOME=$(mktemp -d)
  mkdir -p "$FAKE_HOME/.cargo/bin"
  cp "$STUB_DIR/codescout" "$FAKE_HOME/.cargo/bin/codescout"
  export CS_STUB_RESPONSE='[{"id":"C-2","tracker_id":"t1","title":"Never commit secrets","rule":"R"}]'

  rm -rf "$PROJECT/.codescout/constitution-seen"
  got=$(mkinput s8 | env -u CLAUDE_CONFIG_DIR HOME="$FAKE_HOME" PATH="$MIN_PATH" "$NODE_BIN" "$HOOK")
  if echo "$got" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit" and (.hookSpecificOutput.additionalContext | length > 0)' >/dev/null 2>&1; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: binary only in ~/.cargo/bin -> UserPromptSubmit context (raw: $got)"
  fi

  rm -rf "$PROJECT/.codescout/constitution-seen"
  got=$(mkinput s9 | env -u CLAUDE_CONFIG_DIR HOME="$EMPTY_HOME" PATH="$MIN_PATH" "$NODE_BIN" "$HOOK"; echo "rc=$?")
  if [ "$got" = "rc=0" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: binary nowhere -> no output, exit 0 (raw: $got)"
  fi
  rm -rf "$FAKE_HOME" "$EMPTY_HOME"
fi
rm -rf "$PROJECT/.codescout/constitution-seen"

echo "== constitution-brief.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
