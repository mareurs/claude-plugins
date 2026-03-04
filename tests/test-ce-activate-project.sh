#!/bin/bash
# tests/test-ce-activate-project.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── ce-activate-project ──"
HOOK="$HOOK_DIR/ce-activate-project.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/main"
make_worktree "$T/main" "$T/wt"

ACTIVATE_TOOL="mcp__code-explorer__activate_project"

# Test 1: non-activate_project tool → silent exit
OUT=$(printf '{"tool_name":"mcp__code-explorer__list_symbols","tool_input":{"path":"%s"}}' "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "non-activate: silent exit"; else fail "non-activate: silent exit" "$OUT"; fi

# Test 2: activate_project, no marker → silent exit
OUT=$(printf '{"tool_name":"%s","tool_input":{"path":"%s"}}' "$ACTIVATE_TOOL" "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no marker: silent exit"; else fail "no marker: silent exit" "$OUT"; fi

# Test 3: activate_project, marker present → marker deleted, confirmation in context
make_pending_marker "$T/wt"
OUT=$(printf '{"tool_name":"%s","tool_input":{"path":"%s"}}' "$ACTIVATE_TOOL" "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if [ ! -f "$T/wt/.ce-worktree-pending" ] && assert_context_contains "$OUT" "CE switched"; then
  pass "marker present: deleted + confirmed"
else
  fail "marker present: deleted + confirmed" \
    "marker_exists=$([ -f "$T/wt/.ce-worktree-pending" ] && echo yes || echo no) out=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -1)"
fi

print_summary "ce-activate-project"
