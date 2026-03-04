#!/bin/bash
# tests/test-session-start.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── session-start ──"
HOOK="$HOOK_DIR/session-start.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# --- Test 1: no CE → silent exit ---
make_git_repo "$T/t1"
OUT=$(printf '{"cwd":"%s"}' "$T/t1" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# --- Test 2: CE configured, not onboarded (no project.toml) ---
make_git_repo "$T/t2"
write_mcp_json "$T/t2"
OUT=$(printf '{"cwd":"%s"}' "$T/t2" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "not yet onboarded"; then
  pass "not onboarded: hint shown"
else
  fail "not onboarded: hint shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -3)"
fi

# --- Test 3: has memories → CE MEMORIES: shown ---
make_git_repo "$T/t3"
write_mcp_json "$T/t3"
make_ce_dir "$T/t3"
make_memories "$T/t3"
OUT=$(printf '{"cwd":"%s"}' "$T/t3" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "codescout MEMORIES:"; then
  pass "memories: hint shown"
else
  fail "memories: hint shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -3)"
fi

# --- Test 4: has system-prompt.md → content injected ---
make_git_repo "$T/t4"
write_mcp_json "$T/t4"
make_ce_dir "$T/t4"
make_system_prompt "$T/t4"
OUT=$(printf '{"cwd":"%s"}' "$T/t4" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "system-prompt: injected"
else
  fail "system-prompt: injected" "$OUT"
fi

# --- Test 5: index stale → INDEX: Refreshing message ---
make_git_repo "$T/t5"
write_mcp_json "$T/t5"
make_ce_dir "$T/t5"
seed_sqlite_db "$T/t5" "deadbeef0000000000000000000000000000000000"
OUT=$(printf '{"cwd":"%s"}' "$T/t5" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "INDEX: Refreshing"; then
  pass "stale index: refresh triggered"
else
  fail "stale index: refresh triggered" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

# --- Test 6: index current → no INDEX message ---
make_git_repo "$T/t6"
write_mcp_json "$T/t6"
make_ce_dir "$T/t6"
HEAD=$(git -C "$T/t6" rev-parse HEAD)
seed_sqlite_db "$T/t6" "$HEAD"
OUT=$(printf '{"cwd":"%s"}' "$T/t6" | bash "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "INDEX:"; then
  pass "current index: no refresh"
else
  fail "current index: no refresh" "index message appeared unexpectedly"
fi

# --- Test 7: inside worktree → WORKTREE SESSION, no INDEX ---
make_git_repo "$T/t7main"
write_mcp_json "$T/t7main"
make_ce_dir "$T/t7main"
seed_sqlite_db "$T/t7main" "deadbeef0000000000000000000000000000000000"
make_worktree "$T/t7main" "$T/t7wt"
cp "$T/t7main/.mcp.json" "$T/t7wt/.mcp.json"
cp "$T/t7main/fake-ce" "$T/t7wt/fake-ce" 2>/dev/null || true
ln -s "$T/t7main/.code-explorer" "$T/t7wt/.code-explorer"
OUT=$(printf '{"cwd":"%s"}' "$T/t7wt" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "WORKTREE SESSION" && ! assert_context_contains "$OUT" "INDEX:"; then
  pass "worktree: WORKTREE SESSION shown, no INDEX"
else
  fail "worktree: WORKTREE SESSION shown, no INDEX" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

# --- Test 8: drift warnings ---
make_git_repo "$T/t8"
write_mcp_json "$T/t8"
make_ce_dir "$T/t8" "true"
HEAD=$(git -C "$T/t8" rev-parse HEAD)
seed_drift_db "$T/t8" "$HEAD"
OUT=$(printf '{"cwd":"%s"}' "$T/t8" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "DRIFT WARNING"; then
  pass "drift: warning shown"
else
  fail "drift: warning shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

print_summary "session-start"
