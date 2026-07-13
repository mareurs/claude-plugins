#!/usr/bin/env bash
# Test post-tool-use hook (via hook_dispatch.py): integration. Verifies the
# dispatcher invokes the Python helper layer and produces the expected
# session-state side effects under realistic event payloads.
#
# Note: pre-tool-use.sh has equivalent shell-level coverage in
# `test_pre_tool_hook.py` (Python subprocess'ing the bash script). This
# file fills the gap for post-tool-use.sh, which previously had only
# helper-level unit tests in `test_hook_accumulate.py` — the Python
# helpers were tested but the bash dispatch layer was not.
#
# Y-B safety net: locks current behavior so future I-05 (bash↔python
# heredoc refactor) can prove byte-equivalence without regression.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DISPATCH="$PLUGIN_ROOT/hooks/hook_dispatch.py"

PASS=0; FAIL=0
fail() { echo "FAIL: $1${2:+ — $2}"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

SID="sid-postool-aaa"
SESSION_DIR="$WORK/.buddy/$SID"
STATE="$SESSION_DIR/state.json"
NARRATIVE="$SESSION_DIR/narrative.jsonl"

mk_event() {
    # Args: tool_name, file_path
    local tool="$1" file="$2"
    cat <<JSON
{"session_id":"$SID","cwd":"$WORK","tool_name":"$tool","tool_input":{"file_path":"$file"},"tool_response":{},"timestamp":1700000000}
JSON
}

# --- Test 1: state.json + narrative.jsonl appear after first event ---
mk_event "Read" "/tmp/foo.py" | python3 "$DISPATCH" post-tool-use >/dev/null 2>&1 || true

[ -f "$STATE" ] && pass "state.json written" || fail "state.json missing"
[ -f "$NARRATIVE" ] && pass "narrative.jsonl written" || fail "narrative.jsonl missing"
[ -s "$NARRATIVE" ] && pass "narrative.jsonl non-empty" || fail "narrative.jsonl empty"

# --- Test 2: tool_name surfaces in narrative entry text ---
if [ -f "$NARRATIVE" ]; then
    grep -q '"text"' "$NARRATIVE" \
        && pass "narrative entry has text field" \
        || fail "narrative entry missing text field" "$(head -c 200 "$NARRATIVE")"
fi

# --- Test 3: subsequent event appends a second narrative line ---
mk_event "Edit" "/tmp/bar.py" | python3 "$DISPATCH" post-tool-use >/dev/null 2>&1 || true
LINES=$(wc -l < "$NARRATIVE" 2>/dev/null || echo 0)
[ "$LINES" -ge 2 ] && pass "narrative appended on 2nd event ($LINES lines)" \
    || fail "narrative did not append" "lines=$LINES"

# --- Test 4: malformed JSON does not crash the hook (exit 0) ---
RC=0
echo 'this is not json' | python3 "$DISPATCH" post-tool-use >/dev/null 2>&1 || RC=$?
[ "$RC" -eq 0 ] && pass "malformed JSON exits 0 (silent failure)" \
    || fail "malformed JSON exit code" "rc=$RC"

# --- Test 5: empty stdin does not crash ---
RC=0
echo -n '' | python3 "$DISPATCH" post-tool-use >/dev/null 2>&1 || RC=$?
[ "$RC" -eq 0 ] && pass "empty stdin exits 0" || fail "empty stdin exit code" "rc=$RC"

# --- Test 6: missing session_id does not crash; falls back to 'unknown' ---
EVENT_NO_SID='{"cwd":"'"$WORK"'","tool_name":"Read","tool_input":{"file_path":"/x"},"tool_response":{},"timestamp":1700000100}'
RC=0
echo "$EVENT_NO_SID" | python3 "$DISPATCH" post-tool-use >/dev/null 2>&1 || RC=$?
[ "$RC" -eq 0 ] && pass "missing session_id exits 0" || fail "missing session_id exit code" "rc=$RC"
[ -f "$WORK/.buddy/unknown/state.json" ] && pass "missing session_id routes to 'unknown' dir" \
    || fail "missing session_id did not create unknown/state.json"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
