#!/bin/bash
# tests/test-worktree-write-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── worktree-write-guard ──"
HOOK="$HOOK_DIR/worktree-write-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/main"
make_worktree "$T/main" "$T/wt"

WRITE_TOOL="mcp__code-explorer__replace_symbol"
READ_TOOL="mcp__code-explorer__list_symbols"

# Test 1: non-write tool → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$READ_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "non-write tool: allow"; else fail "non-write tool: allow" "$OUT"; fi

# Test 2: write tool, CWD in main repo (not worktree) → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/main" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "main repo: allow"; else fail "main repo: allow" "$OUT"; fi

# Test 3: write tool, in worktree, no marker → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "worktree, no marker: allow"; else fail "worktree, no marker: allow" "$OUT"; fi

# Test 4: write tool, in worktree, marker present → deny
make_pending_marker "$T/wt"
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "activate_project"; then
  pass "worktree + marker: deny with activate_project"
else
  fail "worktree + marker: deny with activate_project" "$OUT"
fi

print_summary "worktree-write-guard"
