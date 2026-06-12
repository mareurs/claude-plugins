#!/bin/bash
# tests/test-session-start-payload.sh — payload-size and pointer-content
# regression guard for the injection-budget redesign.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── session-start payload ──"
HOOK="$HOOK_DIR/session-start.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

FAKE_HOME="$T/_home"
mkdir -p "$FAKE_HOME"

make_git_repo "$T/proj"
make_codescout_dir "$T/proj"
# Place memories + system-prompt under .codescout/ (fixture's make_memories
# uses legacy .codescout/ which loses to .codescout/ in detect.py's project-dir lookup).
mkdir -p "$T/proj/.codescout/memories"
echo "# Arch" > "$T/proj/.codescout/memories/arch.md"
echo "# Patterns" > "$T/proj/.codescout/memories/patterns.md"
echo "SYSTEM PROMPT CONTENT" > "$T/proj/.codescout/system-prompt.md"
# Inline .mcp.json with codescout-matching command (fixture write_mcp_json
# uses fake-ce which doesn't match detect.py's codescout|codescout regex).
cat > "$T/proj/.mcp.json" <<'MCP'
{"mcpServers":{"codescout":{"command":"/usr/local/bin/codescout","args":["serve"]}}}
MCP

run_hook() {
  HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="" bash "$HOOK" 2>/dev/null
}

INPUT=$(printf '{"cwd":"%s","session_id":"size-sid","source":"startup"}' "$T/proj")
OUT=$(echo "$INPUT" | run_hook)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
SIZE=${#CTX}

# Test 1: total payload ≤ 2048 bytes
if [ "$SIZE" -le 2048 ]; then
  pass "payload size $SIZE B ≤ 2048"
else
  fail "payload size $SIZE B exceeds 2 KB preview cap"
fi

# Test 2: recon pointer present in first 2 KB
PREVIEW=$(printf '%s' "$CTX" | head -c 2048)
if echo "$PREVIEW" | grep -q "codescout-companion:reconnaissance"; then
  pass "recon pointer in first 2 KB"
else
  fail "recon pointer in first 2 KB"
fi

# Test 3: system-prompt pointer REMOVED (main agent gets it from codescout's
# ## Custom Instructions; subagents via subagent-guidance.sh — claude-code#29655)
if echo "$CTX" | grep -q 'memory(action="read", topic="system-prompt")'; then
  fail "system-prompt pointer should be removed"
else
  pass "system-prompt pointer removed"
fi

# Test 4: no verbatim recon SKILL.md body
if echo "$CTX" | grep -q "## When to Use"; then
  fail "verbatim recon body still present (expected pointer only)"
else
  pass "no verbatim recon body"
fi

# Test 5: no verbatim system prompt body
if echo "$CTX" | grep -q "SYSTEM PROMPT CONTENT"; then
  fail "verbatim system prompt still present"
else
  pass "no verbatim system prompt body"
fi

# Test 6: memory hint preserved
if echo "$PREVIEW" | grep -q "codescout MEMORIES"; then
  pass "memory hint preserved"
else
  fail "memory hint preserved"
fi

# Test 7: recon-loaded marker still written
if [ -f "$T/proj/.buddy/size-sid/recon-loaded" ]; then
  pass "recon-loaded marker written (statusline badge)"
else
  fail "recon-loaded marker written" "missing $T/proj/.buddy/size-sid/recon-loaded"
fi

print_summary "session-start payload"
