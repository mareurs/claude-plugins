#!/usr/bin/env bash
# Test: pre-task-hint.sh is wired to the CURRENT subagent-dispatch tool name.
#
# Regression for the Task -> Agent rename (2026-06-13). Claude Code renamed the
# subagent-dispatch tool from `Task` to `Agent`, but hooks.json still matched
# "Task" — so this PreToolUse hint never fired and the per-dispatch
# reconnaissance nudge was silently dead across the whole harness. The live
# tool name is verifiable in transcripts: ~932 `"name":"Agent"`, 0 `"name":"Task"`.
#
# This guards the wiring (config), not the script's emission logic — the
# matcher is CC routing, invisible to the script when invoked directly.

set -uo pipefail

HOOKS_JSON="$(cd "$(dirname "$0")" && pwd)/hooks.json"
PASS=0
FAIL=0

check() {  # <label> <got> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "PASS [$1]"; PASS=$((PASS+1))
  else
    echo "FAIL [$1]: expected=$3 got=$2"; FAIL=$((FAIL+1))
  fi
}

# The PreToolUse matcher that routes to pre-task-hint.sh must be the live
# dispatch tool name.
matcher=$(jq -r '
  .hooks.PreToolUse[]
  | select(any(.hooks[]?; ((.command // "") + " " + ((.args // []) | join(" "))) | test("pre-task-hint\\.mjs")))
  | .matcher' "$HOOKS_JSON")
check "pre-task-hint wired to Agent" "$matcher" "Agent"

# Guard against regression to the obsolete tool name anywhere in PreToolUse.
task_matchers=$(jq -r '[.hooks.PreToolUse[] | select(.matcher=="Task")] | length' "$HOOKS_JSON")
check "no obsolete Task matcher in PreToolUse" "$task_matchers" "0"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
