#!/bin/bash
# tests/test-pre-task-hint.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-task-hint ──"
HOOK="$HOOK_DIR/pre-task-hint.sh"
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
  printf '{"cwd":"%s","session_id":"%s","tool_name":"Task","tool_input":{}}' "$T/proj" "$1"
}

run_hook() {
  HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="" bash "$HOOK" 2>/dev/null
}

# Test 1: first Task call → emits hint
OUT=$(hook_input "sid-1" | run_hook)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "first call: hint emitted"
else
  fail "first call: hint emitted" "$OUT"
fi

if [ -f "$T/proj/.buddy/sid-1/hint-emitted-recon" ]; then
  pass "first call: marker written"
else
  fail "first call: marker written" "missing $T/proj/.buddy/sid-1/hint-emitted-recon"
fi

# Test 2: second Task call same SID → silent
OUT=$(hook_input "sid-1" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "second call same SID: silent"
else
  fail "second call same SID: silent" "ctx=$CTX"
fi

# Test 3: new SESSION_ID → re-emits
OUT=$(hook_input "sid-2" | run_hook)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "new SID: re-emits"
else
  fail "new SID: re-emits" "$OUT"
fi

# Test 4: codescout absent → exits 0 silently
rm -rf "$T/proj/.codescout"
rm -f "$T/proj/.mcp.json"
OUT=$(hook_input "sid-3" | run_hook)
EC=$?
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ "$EC" -eq 0 ] && [ -z "$CTX" ]; then
  pass "no codescout: silent exit 0"
else
  fail "no codescout: silent exit 0" "ec=$EC ctx=$CTX"
fi

# Test 5: empty session_id → no marker, but exits 0
make_codescout_dir "$T/proj"
cat > "$T/proj/.mcp.json" <<'MCP'
{"mcpServers":{"codescout":{"command":"/usr/local/bin/codescout","args":["serve"]}}}
MCP
OUT=$(printf '{"cwd":"%s","session_id":"","tool_name":"Task","tool_input":{}}' "$T/proj" | run_hook)
EC=$?
if [ "$EC" -eq 0 ] && ! [ -f "$T/proj/.buddy//hint-emitted-recon" ]; then
  pass "empty session_id: exit 0 no marker"
else
  fail "empty session_id: exit 0 no marker" "ec=$EC"
fi

# Test 6: payload size — hint <500 bytes well under 2 KB cap
OUT=$(hook_input "sid-size" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
SIZE=${#CTX}
if [ "$SIZE" -gt 0 ] && [ "$SIZE" -lt 500 ]; then
  pass "hint size <500 bytes (got $SIZE)"
else
  fail "hint size <500 bytes" "size=$SIZE"
fi

print_summary "pre-task-hint"
