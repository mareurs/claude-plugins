
#!/bin/bash
# tests/test-hooks-json-registration.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── hooks.json registration ──"
HOOKS_JSON="$HOOK_DIR/hooks.json"
# PreToolUse and PostToolUse hooks run through dispatch.mjs, one node process per event.
# hooks.json holds one dispatcher entry per event; dispatch-table.json holds the
# matcher -> hook registrations that the assertions below are about.
TABLE="$HOOK_DIR/dispatch-table.json"

# Test 1: hooks.json and the table parse as valid JSON
if jq empty "$HOOKS_JSON" 2>/dev/null; then
  pass "hooks.json is valid JSON"
else
  fail "hooks.json is valid JSON"
fi
if jq empty "$TABLE" 2>/dev/null; then
  pass "dispatch-table.json is valid JSON"
else
  fail "dispatch-table.json is valid JSON"
fi

# VS Code invokes the command field but ignores Claude Code's separate args
# field. Every Node hook must therefore name its script directly in command; a
# plain word after the script (the dispatcher's event name) is part of the string.
PORTABLE=$(jq -r '[.hooks[][]?.hooks[]
  | select(.type == "command")
  | (.args == null and (.command | test("^node \\${CLAUDE_PLUGIN_ROOT}/hooks/[^ ]+\\.mjs( [A-Za-z-]+)?$")))]
  | all' "$HOOKS_JSON")
if [[ "$PORTABLE" == "true" ]]; then
  pass "all Node hooks use portable command strings"
else
  fail "all Node hooks use portable command strings"
fi

# Test 1b: each tool-use event has exactly one dispatcher entry, and no table hook
# is also registered on its own (it would run twice).
for EVENT in PreToolUse PostToolUse; do
  # The dispatcher runs inside a loopback daemon (hookd.mjs): hooks.json holds one http entry per event.
  N=$(jq -r --arg ev "$EVENT" '[.hooks[$ev][] | .hooks[] | select(.type == "http" and .url == ("http://127.0.0.1:47615/" + $ev))] | length' "$HOOKS_JSON")
  if [[ "$N" == "1" ]]; then
    pass "$EVENT -> one daemon entry"
  else
    fail "$EVENT -> one daemon entry" "got $N"
  fi
  TWICE=$(jq -r --arg ev "$EVENT" --slurpfile t "$TABLE" \
    '[.hooks[$ev][] | .hooks[].command // empty] as $cmds
     | [$t[0][$ev][].hook as $h | select($cmds | any(contains("/hooks/" + $h)))] | length' "$HOOKS_JSON")
  if [[ "$TWICE" == "0" ]]; then
    pass "$EVENT: no table hook is registered a second time"
  else
    fail "$EVENT: no table hook is registered a second time" "got $TWICE"
  fi
done

# hooks_for <event> <matcher> prints the hooks the table registers on that exact matcher.
hooks_for() { jq -r --arg ev "$1" --arg m "$2" '.[$ev][] | select(.matcher == $m) | .hook' "$TABLE"; }

# Test 2: Agent matcher registered to pre-task-hint.mjs
# (subagent-dispatch tool was renamed Task -> Agent, 2026-06-13; matching the
# old name silently disabled this hook — see pre-task-hint.test.sh)
MATCH=$(hooks_for PreToolUse Agent)
if echo "$MATCH" | grep -q "pre-task-hint.mjs"; then
  pass "Agent matcher → pre-task-hint.mjs"
else
  fail "Agent matcher → pre-task-hint.mjs" "got: $MATCH"
fi

# Test 2b: Agent matcher also registered to explore-inject.mjs (foreign-project
# bootstrap injector — a second Agent hook alongside pre-task-hint.mjs)
if echo "$MATCH" | grep -q "explore-inject.mjs"; then
  pass "Agent matcher → explore-inject.mjs"
else
  fail "Agent matcher → explore-inject.mjs" "got: $MATCH"
fi

# Test 3: edit_code matcher registered to pre-edit-hint.mjs
MATCH=$(jq -r '.PreToolUse[] | select(.matcher | test("edit_code")) | .hook' "$TABLE")
if echo "$MATCH" | grep -q "pre-edit-hint.mjs"; then
  pass "edit_code matcher → pre-edit-hint.mjs"
else
  fail "edit_code matcher → pre-edit-hint.mjs" "got: $MATCH"
fi

# Test 3b: the dirty-check hook is registered on a matcher covering the NATIVE
# Edit/Write tools, not only the MCP ones. Asserted on the matcher->hook mapping
# rather than by grepping for the hook's name: a bare string grep passes on a file
# that merely MENTIONS the hook, including under a matcher that could never fire.
# The claim being made is about coverage, so coverage is what is tested.
MATCH=$(jq -r '.PreToolUse[] | select((.matcher | test("Edit")) and (.matcher | test("Write"))) | .hook' "$TABLE")
if echo "$MATCH" | grep -q "pre-edit-dirty-check.mjs"; then
  pass "Edit|Write matcher → pre-edit-dirty-check.mjs"
else
  fail "Edit|Write matcher → pre-edit-dirty-check.mjs" "got: $MATCH"
fi

# Test 3c: the suspicious-zero hint is registered on PostToolUse/Bash. It has to
# be PostToolUse specifically -- the predicate reads the tool RESULT, which a
# PreToolUse hook structurally cannot see -- so the EVENT is asserted, not just
# the presence of the hook somewhere in the file.
MATCH=$(hooks_for PostToolUse Bash)
if echo "$MATCH" | grep -q "suspicious-zero-hint.mjs"; then
  pass "PostToolUse/Bash matcher -> suspicious-zero-hint.mjs"
else
  fail "PostToolUse/Bash matcher -> suspicious-zero-hint.mjs" "got: $MATCH"
fi

# Test 3d: the cs-verified relocation hook is registered on PostToolUse with the
# codescout matcher. The EVENT is asserted: the hook reads the tool RESULT and
# rewrites it, which PreToolUse cannot do, and `mcp__codescout__.*` is already
# registered there for principal-stamp.mjs, so a bare "matcher exists" check
# would pass on the wrong event. `timeout` must be 5 (the hook runs after every
# codescout call; a hang must not cost a session the default timeout) and the
# dispatcher enforces it per hook. The script must also exist and parse under node.
CSV_ENTRY=$(jq -c '[.PostToolUse[] | select(.hook == "cs-verified-relocate.mjs")]' "$TABLE")
CSV_PRE=$(jq -r '[.PreToolUse[] | select(.hook == "cs-verified-relocate.mjs")] | length' "$TABLE")
CSV_COUNT=$(echo "$CSV_ENTRY" | jq 'length')
# The WHOLE entry, so a stringly `"timeout": "5"`, a different matcher or a stray
# field cannot slip past the field checks.
CSV_EXACT=$(echo "$CSV_ENTRY" | jq -r '.[0] == {"matcher":"mcp__codescout__.*","hook":"cs-verified-relocate.mjs","timeout":5}')
# And nothing may register it on its own: an async or unbounded run would not apply its rewrite.
CSV_DIRECT=$(jq -r '[.hooks | to_entries[] | .value[] | .hooks[] | select((.command // "") | test("cs-verified-relocate"))] | length' "$HOOKS_JSON")
CSV_SCRIPT="$HOOK_DIR/cs-verified-relocate.mjs"
if [[ "$CSV_COUNT" == "1" && "$CSV_PRE" == "0" && "$CSV_EXACT" == "true" && "$CSV_DIRECT" == "0" ]] \
   && [[ -f "$CSV_SCRIPT" ]] && node --check "$CSV_SCRIPT" 2>/dev/null; then
  pass "PostToolUse/mcp__codescout__.* -> cs-verified-relocate.mjs (timeout 5, script parses)"
else
  fail "PostToolUse/mcp__codescout__.* -> cs-verified-relocate.mjs (timeout 5, script parses)" \
    "count=$CSV_COUNT pre=$CSV_PRE exact=$CSV_EXACT direct=$CSV_DIRECT"
fi

# Test 4: existing registrations preserved
for keep in "pre-tool-guard.mjs" "worktree-write-guard.mjs"; do
  if jq -e --arg h "$keep" '[.PreToolUse[].hook] | index($h)' "$TABLE" >/dev/null; then
    pass "preserved: $keep"
  else
    fail "preserved: $keep"
  fi
done

print_summary "hooks.json registration"
