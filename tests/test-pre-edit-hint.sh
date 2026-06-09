#!/bin/bash
# tests/test-pre-edit-hint.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-edit-hint ──"
HOOK="$HOOK_DIR/pre-edit-hint.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

FAKE_HOME="$T/_home"
mkdir -p "$FAKE_HOME"

make_git_repo "$T/proj"
make_codescout_dir "$T/proj"  # marks codescout as detected
# write_mcp_json fixture uses fake-ce which doesn't match detect.py's
# `codescout|codescout` regex; write directly with a matching command
cat > "$T/proj/.mcp.json" <<'MCP'
{"mcpServers":{"codescout":{"command":"/usr/local/bin/codescout","args":["serve"]}}}
MCP

hook_input() {
  local sid="$1"
  local tool="$2"
  printf '{"cwd":"%s","session_id":"%s","tool_name":"%s","tool_input":{}}' "$T/proj" "$sid" "$tool"
}

run_hook() {
  HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="" bash "$HOOK" 2>/dev/null
}

# Test 1: first edit_code call → emits hint
OUT=$(hook_input "sid-1" "mcp__codescout__edit_code" | run_hook)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "first edit_code: hint emitted"
else
  fail "first edit_code: hint emitted" "$OUT"
fi

if [ -f "$T/proj/.buddy/sid-1/hint-emitted-recon-edit" ]; then
  pass "first edit_code: marker written (recon-edit)"
else
  fail "first edit_code: marker written" "missing marker"
fi

# Test 2: second edit_code same SID → silent
OUT=$(hook_input "sid-1" "mcp__codescout__edit_code" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "second edit_code same SID: silent"
else
  fail "second edit_code same SID: silent" "ctx=$CTX"
fi

# Test 3: replace_symbol counts under same marker (both are shape-changing)
OUT=$(hook_input "sid-1" "mcp__codescout__replace_symbol" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "replace_symbol after edit_code: silent (shared marker)"
else
  fail "replace_symbol after edit_code: silent" "ctx=$CTX"
fi

# Test 4: fresh session, first replace_symbol → emits
OUT=$(hook_input "sid-2" "mcp__codescout__replace_symbol" | run_hook)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "fresh SID first replace_symbol: emits"
else
  fail "fresh SID first replace_symbol: emits" "$OUT"
fi

# Test 5: hint mentions shape-change context
OUT=$(hook_input "sid-3" "mcp__codescout__edit_code" | run_hook)
if assert_context_contains "$OUT" "shape" || assert_context_contains "$OUT" "struct" || assert_context_contains "$OUT" "signature"; then
  pass "hint mentions shape-change semantics"
else
  fail "hint mentions shape-change semantics" "$OUT"
fi

# Test 6: codescout absent → exit 0 silently
rm -rf "$T/proj/.codescout" "$T/proj/.mcp.json"
OUT=$(hook_input "sid-4" "mcp__codescout__edit_code" | run_hook)
EC=$?
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ "$EC" -eq 0 ] && [ -z "$CTX" ]; then
  pass "no codescout: silent exit 0"
else
  fail "no codescout: silent exit 0" "ec=$EC ctx=$CTX"
fi

print_summary "pre-edit-hint"
