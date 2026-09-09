#!/bin/bash
# tests/test-pre-edit-dirty-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-edit-dirty-check ──"
HOOK="$HOOK_DIR/pre-edit-dirty-check.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

FAKE_HOME="$T/_home"
mkdir -p "$FAKE_HOME"

make_git_repo "$T/proj"
echo "original" > "$T/proj/shared.txt"
echo "original" > "$T/proj/mine.txt"
git -C "$T/proj" add . >/dev/null 2>&1
git -C "$T/proj" commit -q -m "add files"

hook_input() {
  local sid="$1" path="$2"
  printf '{"cwd":"%s","session_id":"%s","tool_name":"Edit","tool_input":{"file_path":"%s"}}' \
    "$T/proj" "$sid" "$path"
}

run_hook() {
  HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="" node "$HOOK" 2>/dev/null
}

# --- 1. A file dirtied by someone else, never touched by this session, warns.
#        This is the whole point: at edit time, before the two diffs entangle.
printf 'a peer wrote this\n' >> "$T/proj/shared.txt"
OUT=$(hook_input "sid-1" "$T/proj/shared.txt" | run_hook)
if assert_context_contains "$OUT" "shared.txt"; then
  pass "dirty + unmarked: warns and names the path"
else
  fail "dirty + unmarked: warns and names the path" "$OUT"
fi

# --- 2. Claim only what is proven (ADR clause 3). `git status` establishes that
#        the content is uncommitted and unmarked. It does NOT establish a peer.
#        Naming an unchecked cause ends the search for the real one.
if assert_context_contains "$OUT" "this session did not"; then
  pass "message claims only what git proves (no invented peer)"
else
  fail "message claims only what git proves" "$OUT"
fi

# --- 3. The remedy names an action its addressee can actually perform.
#        A guard whose message sends you nowhere is decoration (CLAUDE.md).
if assert_context_contains "$OUT" "file-provenance.py"; then
  pass "message names a runnable next step"
else
  fail "message names a runnable next step" "$OUT"
fi

# --- 4. Bounded noise: the same path a second time is silent.
OUT2=$(hook_input "sid-1" "$T/proj/shared.txt" | run_hook)
CTX=$(echo "$OUT2" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "same path twice: silent (one warning per path per session)"
else
  fail "same path twice: silent" "ctx=$CTX"
fi

# --- 5. DISCRIMINATOR. A clean file must be silent. A guard that warns always
#        is a guard nobody reads — this is the test that fails if the hook
#        degenerates into unconditional noise.
OUT=$(hook_input "sid-2" "$T/proj/mine.txt" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "clean file: silent"
else
  fail "clean file: silent" "ctx=$CTX"
fi

# --- 6. DISCRIMINATOR. Dirt this session created is not foreign. Sequence:
#        edit a clean file (marker written), dirty it, edit again -> silent.
hook_input "sid-3" "$T/proj/mine.txt" | run_hook >/dev/null
printf 'i wrote this myself\n' >> "$T/proj/mine.txt"
OUT=$(hook_input "sid-3" "$T/proj/mine.txt" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "dirt this session made: silent"
else
  fail "dirt this session made: silent" "ctx=$CTX"
fi

# --- 7. A different session sees the same dirt as foreign. Confirms the marker
#        is session-scoped and not a global "already warned" flag.
OUT=$(hook_input "sid-4" "$T/proj/mine.txt" | run_hook)
if assert_context_contains "$OUT" "mine.txt"; then
  pass "another session sees the same dirt as foreign"
else
  fail "another session sees the same dirt as foreign" "$OUT"
fi

# --- 8. Not a git repo: git() returns null. Null is UNKNOWN, never CLEAN --
#        but unknown must not warn either. Silent, exit 0.
mkdir -p "$T/bare"
OUT=$(printf '{"cwd":"%s","session_id":"s","tool_name":"Edit","tool_input":{"file_path":"%s"}}' \
        "$T/bare" "$T/bare/x.txt" | run_hook)
RC=$?
if check_rc "$RC" && assert_no_output "$OUT"; then
  pass "non-git dir: silent, exit 0"
else
  fail "non-git dir: silent, exit 0" "rc=$RC out=$OUT"
fi

# --- 9. Fail-open contract (lib.mjs:5-8): a non-zero PreToolUse exit is itself
#        a deny on Copilot CLI. Garbage stdin must still exit 0.
OUT=$(printf 'not json at all' | run_hook)
RC=$?
if check_rc "$RC"; then
  pass "garbage stdin: exit 0 (fail-open)"
else
  fail "garbage stdin: exit 0 (fail-open)" "rc=$RC"
fi

# --- 10. It warns; it never denies. Escalation to deny needs the tracker's bar.
OUT=$(hook_input "sid-9" "$T/proj/shared.txt" | run_hook)
if assert_denied "$OUT"; then
  fail "never denies" "hook returned a deny decision"
else
  pass "never denies (advisory only)"
fi

print_summary "pre-edit-dirty-check"
