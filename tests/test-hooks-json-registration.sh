#!/bin/bash
# tests/test-hooks-json-registration.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── hooks.json registration ──"
HOOKS_JSON="$HOOK_DIR/hooks.json"

# Test 1: hooks.json parses as valid JSON
if jq empty "$HOOKS_JSON" 2>/dev/null; then
  pass "hooks.json is valid JSON"
else
  fail "hooks.json is valid JSON"
fi

# Test 2: Task matcher registered to pre-task-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Task") | .hooks[0].command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-task-hint.sh"; then
  pass "Task matcher → pre-task-hint.sh"
else
  fail "Task matcher → pre-task-hint.sh" "got: $MATCH"
fi

# Test 3: edit_code|replace_symbol matcher registered to pre-edit-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher | test("edit_code|replace_symbol")) | .hooks[0].command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-edit-hint.sh"; then
  pass "edit_code|replace_symbol matcher → pre-edit-hint.sh"
else
  fail "edit_code|replace_symbol matcher → pre-edit-hint.sh" "got: $MATCH"
fi

# Test 4: existing matchers preserved
for keep in "pre-tool-guard.sh" "il3-warn-hook.sh" "worktree-write-guard.sh"; do
  if grep -q "$keep" "$HOOKS_JSON"; then
    pass "preserved: $keep"
  else
    fail "preserved: $keep"
  fi
done

print_summary "hooks.json registration"
