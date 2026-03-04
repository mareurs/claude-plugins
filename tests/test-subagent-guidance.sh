#!/bin/bash
# tests/test-subagent-guidance.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── subagent-guidance ──"
HOOK="$HOOK_DIR/subagent-guidance.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"

# Test 1: Bash agent → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"Bash"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "Bash agent: silent exit"; else fail "Bash agent: silent exit" "$OUT"; fi

# Test 2: statusline-setup agent → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"statusline-setup"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "statusline-setup agent: silent exit"; else fail "statusline-setup agent: silent exit" "$OUT"; fi

# Test 3: coding agent, no CE → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"general-purpose"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# Test 4: coding agent, CE present, system prompt → context contains directive + prompt
make_system_prompt "$T/proj"
OUT=$(printf '{"cwd":"%s","agent_type":"general-purpose"}' "$T/proj" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "find_symbol" && assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "CE present: directive + system prompt injected"
else
  fail "CE present: directive + system prompt injected" "$OUT"
fi

print_summary "subagent-guidance"
