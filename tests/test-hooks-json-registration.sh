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

# VS Code invokes the command field but ignores Claude Code's separate args
# field. Every Node hook must therefore name its script directly in command.
PORTABLE=$(jq -r '[.hooks[][]?.hooks[]
  | select(.type == "command")
  | (.args == null and (.command | test("^node \\${CLAUDE_PLUGIN_ROOT}/hooks/.+\\.mjs$")))]
  | all' "$HOOKS_JSON")
if [[ "$PORTABLE" == "true" ]]; then
  pass "all Node hooks use portable command strings"
else
  fail "all Node hooks use portable command strings"
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

# Test 2b: Agent matcher also registered to explore-inject.mjs (foreign-project
# bootstrap injector — a second Agent hook alongside pre-task-hint.sh)
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Agent") | .hooks[] | (.command + " " + ((.args // []) | join(" ")))' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "explore-inject.mjs"; then
  pass "Agent matcher → explore-inject.mjs"
else
  fail "Agent matcher → explore-inject.mjs" "got: $MATCH"
fi

# Test 3: edit_code|replace_symbol matcher registered to pre-edit-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher | test("edit_code|replace_symbol")) | .hooks[] | (.command + " " + ((.args // []) | join(" ")))' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-edit-hint.mjs"; then
  pass "edit_code|replace_symbol matcher → pre-edit-hint.sh"
else
  fail "edit_code|replace_symbol matcher → pre-edit-hint.sh" "got: $MATCH"
fi

# Test 3b: the dirty-check hook is registered on a matcher covering the NATIVE
# Edit/Write tools, not only the MCP ones. Asserted through jq on the
# matcher->hook mapping rather than `grep hooks.json`: a bare string grep passes
# on a file that merely MENTIONS the hook, including under a matcher that could
# never fire. The claim being made is about coverage, so coverage is what is
# tested -- assert on the thing, not on a proxy for it.
MATCH=$(jq -r '.hooks.PreToolUse[] | select((.matcher | test("Edit")) and (.matcher | test("Write"))) | .hooks[] | .command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-edit-dirty-check.mjs"; then
  pass "Edit|Write matcher → pre-edit-dirty-check.mjs"
else
  fail "Edit|Write matcher → pre-edit-dirty-check.mjs" "got: $MATCH"
fi

# Test 3c: the suspicious-zero hint is registered on PostToolUse/Bash. It has to
# be PostToolUse specifically -- the predicate reads the tool RESULT, which a
# PreToolUse hook structurally cannot see -- so the EVENT is asserted, not just
# the presence of the hook somewhere in the file.
MATCH=$(jq -r '.hooks.PostToolUse[] | select(.matcher == "Bash") | .hooks[] | .command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "suspicious-zero-hint.mjs"; then
  pass "PostToolUse/Bash matcher -> suspicious-zero-hint.mjs"
else
  fail "PostToolUse/Bash matcher -> suspicious-zero-hint.mjs" "got: $MATCH"
fi

# Test 3d: the cs-verified relocation hook is registered on PostToolUse with the
# codescout matcher. The EVENT is asserted: the hook reads the tool RESULT and
# rewrites it, which PreToolUse cannot do, and `mcp__codescout__.*` is already
# registered there for principal-stamp.mjs, so a bare "matcher exists" check
# would pass on the wrong event. The command must be the portable string with no
# `args` field, and `timeout` must be 5 (the hook runs after every codescout
# call; a hang must not cost a session the CLI's default timeout). The script
# must also exist and parse under node.
CSV_ENTRY=$(jq -c '[.hooks.PostToolUse[]
  | select(.matcher == "mcp__codescout__.*")
  | .hooks[]
  | select(.command | test("cs-verified-relocate"))]' "$HOOKS_JSON")
CSV_PRE=$(jq -r '[.hooks.PreToolUse[]?.hooks[]? | select(.command | test("cs-verified-relocate"))] | length' "$HOOKS_JSON")
CSV_COUNT=$(echo "$CSV_ENTRY" | jq 'length')
CSV_CMD=$(echo "$CSV_ENTRY" | jq -r '.[0].command // ""')
CSV_ARGS=$(echo "$CSV_ENTRY" | jq -r '.[0] | has("args")')
CSV_TIMEOUT=$(echo "$CSV_ENTRY" | jq -r '.[0].timeout // "none"')
CSV_SCRIPT="$HOOK_DIR/cs-verified-relocate.mjs"
CSV_ALL=$(jq -r '[.hooks | to_entries[] | .key as $ev | .value[] | select(.hooks[].command | test("cs-verified-relocate")) | $ev] | join(",")' "$HOOKS_JSON")
if [[ "$CSV_COUNT" == "1" && "$CSV_PRE" == "0" && "$CSV_ALL" == "PostToolUse" ]] \
   && [[ "$CSV_CMD" =~ ^node\ \$\{CLAUDE_PLUGIN_ROOT\}/hooks/cs-verified-relocate\.mjs$ ]] \
   && [[ "$CSV_ARGS" == "false" && "$CSV_TIMEOUT" == "5" ]] \
   && [[ -f "$CSV_SCRIPT" ]] && node --check "$CSV_SCRIPT" 2>/dev/null; then
  pass "PostToolUse/mcp__codescout__.* -> cs-verified-relocate.mjs (portable, timeout 5, script parses)"
else
  fail "PostToolUse/mcp__codescout__.* -> cs-verified-relocate.mjs (portable, timeout 5, script parses)" \
    "events=$CSV_ALL count=$CSV_COUNT pre=$CSV_PRE cmd=$CSV_CMD has_args=$CSV_ARGS timeout=$CSV_TIMEOUT"
fi

# Test 4: existing matchers preserved
for keep in "pre-tool-guard.mjs" "worktree-write-guard.mjs"; do
  if grep -q "$keep" "$HOOKS_JSON"; then
    pass "preserved: $keep"
  else
    fail "preserved: $keep"
  fi
done

print_summary "hooks.json registration"
