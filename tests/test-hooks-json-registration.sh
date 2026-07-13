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

# Test 2: Agent matcher registered to pre-task-hint.sh
# (subagent-dispatch tool was renamed Task -> Agent, 2026-06-13; matching the
# old name silently disabled this hook — see pre-task-hint.test.sh)
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Agent") | .hooks[] | (.command + " " + ((.args // []) | join(" ")))' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-task-hint.mjs"; then
  pass "Agent matcher → pre-task-hint.sh"
else
  fail "Agent matcher → pre-task-hint.sh" "got: $MATCH"
fi

# Test 2b: Agent matcher also registered to explore-inject.sh (foreign-project
# bootstrap injector — a second Agent hook alongside pre-task-hint.sh)
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Agent") | .hooks[].command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "explore-inject.sh"; then
  pass "Agent matcher → explore-inject.sh"
else
  fail "Agent matcher → explore-inject.sh" "got: $MATCH"
fi

# Test 3: edit_code|replace_symbol matcher registered to pre-edit-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher | test("edit_code|replace_symbol")) | .hooks[] | (.command + " " + ((.args // []) | join(" ")))' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-edit-hint.mjs"; then
  pass "edit_code|replace_symbol matcher → pre-edit-hint.sh"
else
  fail "edit_code|replace_symbol matcher → pre-edit-hint.sh" "got: $MATCH"
fi

# Test 4: existing matchers preserved
for keep in "pre-tool-guard.mjs" "il3-warn-hook.mjs" "worktree-write-guard.mjs"; do
  if grep -q "$keep" "$HOOKS_JSON"; then
    pass "preserved: $keep"
  else
    fail "preserved: $keep"
  fi
done

print_summary "hooks.json registration"
