#!/usr/bin/env bash
# Test for principal-stamp.mjs — the hook that gives the codescout server the one
# thing the MCP wire cannot carry: WHICH principal (parent vs subagent) is calling.
#
# Two assertions here are not about the happy path and are the reason this file
# is worth more than its length:
#
#   * "no-permission-decision" pins the ABSENCE of permissionDecision. The hook
#     matches every codescout tool, so an `allow` here would auto-approve each
#     subagent run_command and edit_code — a permission bypass wearing the
#     clothes of a context optimisation. `updatedInput` is honored on its own
#     (verified against the Claude Code 2.1.270 binary; see the hook header), so
#     the field is pure escalation with no upside. A prototype of this hook DID
#     carry it, and the precision experiment that validated the prototype could
#     not have detected it — that session's permission mode made both worlds look
#     identical. Testing the predicate would not have caught it either: the stamp
#     lands correctly in both. Only asserting the absence does.
#
#   * "foreign-server-*" pins that a non-codescout MCP server is never stamped.
#     The key is ours; injecting it into a tool input we do not own can be
#     rejected by a strict schema, which breaks a call that works today. Missing
#     a differently-named codescout server merely costs the status quo. The two
#     errors are not symmetric, so the matcher is server-scoped and these rows
#     red if a later edit loosens it to tool names.

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/principal-stamp.mjs"
PASS=0
FAIL=0

check() {
    local label="$1" expected="$2" got="$3"
    if [ "$got" = "$expected" ]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        FAIL=$((FAIL+1))
    fi
}

# run <json> -> hook stdout
run() { printf '%s' "$1" | node "$HOOK" 2>/dev/null; }

SUBAGENT=$(jq -n '{
  tool_name: "mcp__codescout__grep",
  session_id: "sess-1",
  agent_id: "agent-a",
  tool_input: {pattern: "foo", glob: "*.rs"}
}')

PARENT=$(jq -n '{
  tool_name: "mcp__codescout__grep",
  session_id: "sess-1",
  tool_input: {pattern: "foo"}
}')

# --- The stamp itself ---
OUT=$(run "$SUBAGENT")
check "stamp-value" "sess-1/agent-a" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.updatedInput["dev.codescout.mcp/agentId"] // "none"')"
check "stamp-event-name" "PreToolUse" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.hookEventName // "none"')"

# updatedInput REPLACES tool_input, so the original fields must be carried over.
# A hook emitting only the key would pass "stamp-value" and silently drop the
# caller's arguments — the single worst failure available to this hook.
check "preserves-pattern" "foo" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.updatedInput.pattern // "none"')"
check "preserves-glob" "*.rs" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.updatedInput.glob // "none"')"

# --- The security assertion: no decision field, at any value ---
check "no-permission-decision" "null" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // "null"')"
check "no-permission-reason" "null" \
    "$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // "null"')"

# --- Parent: silence is the correct signal, not a gap ---
# The server reads an absent key as "restore the parent's own ledger", so a
# stamped parent would be WRONG, not merely redundant.
check "parent-silent" "" "$(run "$PARENT")"

# --- Foreign servers and native tools are never stamped ---
for t in mcp__github__grep mcp__researcher__research mcp__other__run_command; do
    payload=$(jq -n --arg t "$t" '{tool_name:$t, session_id:"s", agent_id:"a", tool_input:{}}')
    check "foreign-server-$t" "" "$(run "$payload")"
done
check "native-tool-Bash" "" \
    "$(run "$(jq -n '{tool_name:"Bash", session_id:"s", agent_id:"a", tool_input:{}}')")"
check "bare-tool-name" "" \
    "$(run "$(jq -n '{tool_name:"grep", session_id:"s", agent_id:"a", tool_input:{}}')")"

# --- Fail-open: never block a call over our own stamping ---
check "empty-stdin" "" "$(run '')"
check "malformed-json" "" "$(run 'not json at all')"
check "missing-session-id" "" \
    "$(run "$(jq -n '{tool_name:"mcp__codescout__grep", agent_id:"a", tool_input:{}}')")"
check "missing-tool-input" "sess-1/agent-a" \
    "$(run "$(jq -n '{tool_name:"mcp__codescout__grep", session_id:"sess-1", agent_id:"agent-a"}')" \
       | jq -r '.hookSpecificOutput.updatedInput["dev.codescout.mcp/agentId"] // "none"')"

printf '%s' "$SUBAGENT" | node "$HOOK" >/dev/null 2>&1
check "exit-code-zero" "0" "$?"
printf '%s' 'not json' | node "$HOOK" >/dev/null 2>&1
check "exit-code-zero-on-garbage" "0" "$?"

# --- The escape hatch for an install that names the server differently ---
ALT=$(jq -n '{tool_name:"mcp__cs__grep", session_id:"s", agent_id:"a", tool_input:{}}')
check "alt-server-unstamped-by-default" "" "$(run "$ALT")"
check "alt-server-stamped-via-env" "s/a" \
    "$(printf '%s' "$ALT" | CS_PRINCIPAL_STAMP_SERVER=cs node "$HOOK" 2>/dev/null \
       | jq -r '.hookSpecificOutput.updatedInput["dev.codescout.mcp/agentId"] // "none"')"

# --- The key must stay byte-identical to the server's PRINCIPAL_ARG_KEY ---
# Drift here is silent in the worst direction: the server ignores an unknown argument
# key, so a typo costs the whole feature and reds nothing at runtime.
#
# TWO checks, because they fail in different places and only one of them runs in CI.
HOOK_KEY=$(grep -o "const KEY = '[^']*'" "$HOOK" | sed "s/.*'\(.*\)'/\1/")

# (a) Pinned literal. Unconditional, so it runs in CI, where no codescout checkout
#     exists. Catches HOOK-SIDE drift only -- editing this literal to match a hook typo
#     is possible, which is exactly why (b) exists and why this is not the whole guard.
check "key-matches-pinned-literal" "dev.codescout.mcp/agentId" "$HOOK_KEY"

# (b) Cross-repo agreement, when the sibling checkout is present. This is the real
#     contract: it reads the Rust constant and so cannot be satisfied by editing this
#     file alone.
#
#     KNOWN CEILING, stated here rather than in a doc nobody opens: (b) SKIPS in CI,
#     and a skip is not a pass. So a change made in the codescout repo that renames
#     PRINCIPAL_ARG_KEY is caught on a developer machine holding both repos and NOWHERE
#     ELSE -- no automated gate in either repository sees both halves. That is the same
#     two-repositories-one-contract shape as the IL-4 hook incident
#     (codescout:docs/issues/archive/2026-09-03-il4-deny-hook-will-deadlock-markdown-reads-after-the-fold.md),
#     which is why it is written down instead of assumed away.
RS="$(cd "$(dirname "$0")" && pwd)/../../../codescout/src/tools/session_key.rs"
if [ -f "$RS" ]; then
    SERVER_KEY=$(grep -o 'PRINCIPAL_ARG_KEY: &str = "[^"]*"' "$RS" | sed 's/.*"\(.*\)"/\1/')
    check "key-matches-server" "$SERVER_KEY" "$HOOK_KEY"
else
    echo "SKIP [key-matches-server]: no codescout checkout at $RS — hook-side drift is still"
    echo "     covered by key-matches-pinned-literal above; SERVER-side drift is NOT covered here."
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
