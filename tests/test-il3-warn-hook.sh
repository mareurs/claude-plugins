#!/bin/bash
# tests/test-il3-warn-hook.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── il3-warn-hook ──"
HOOK="$HOOK_DIR/il3-warn-hook.mjs"

# Helper: build hook input JSON
il3_input() {
  local tool="$1"
  local cmd="$2"
  printf '{"tool_name":"%s","tool_input":{"command":%s}}' "$tool" "$(printf '%s' "$cmd" | jq -Rs .)"
}

# --- Fires (true positives) ---

# Original build-tool path
OUT=$(il3_input "mcp__codescout__run_command" "cargo test 2>&1 | head -20" | node "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "IL3 warning"; then
  pass "fires on cargo | head (build tool)"
else
  fail "fires on cargo | head" "$OUT"
fi

# New: git family (most-slipped family in telemetry)
for cmd in "git log --oneline | head -3" "git status --short | grep M"; do
  OUT=$(il3_input "mcp__codescout__run_command" "$cmd" | node "$HOOK" 2>/dev/null)
  if assert_context_contains "$OUT" "IL3 warning"; then
    pass "fires on: $cmd"
  else
    fail "fires on: $cmd" "$OUT"
  fi
done

# New: find
OUT=$(il3_input "mcp__codescout__run_command" "find . -name '*.rs' | head" | node "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "IL3 warning"; then
  pass "fires on find | head"
else
  fail "fires on find | head" "$OUT"
fi

# New: ls, grep, cat, diff, du
for cmd in "ls -la | head" "grep -r foo src/ | head -50" "cat file.log | tail -20" "diff a b | head" "du -sh */ | sort"; do
  OUT=$(il3_input "mcp__codescout__run_command" "$cmd" | node "$HOOK" 2>/dev/null)
  if assert_context_contains "$OUT" "IL3 warning"; then
    pass "fires on: $cmd"
  else
    fail "fires on: $cmd" "$OUT"
  fi
done

# Other LHS hits
OUT=$(il3_input "mcp__codescout__run_command" "rg --files | head" | node "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "IL3 warning"; then pass "fires on rg | head"; else fail "fires on rg | head" "$OUT"; fi

# --- Does not fire (true negatives) ---

# jq pipeline — structured data flow, not log trimming
OUT=$(il3_input "mcp__codescout__run_command" "cargo metadata --format-version 1 | jq '.packages'" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "allows cargo metadata | jq"
else
  fail "allows cargo metadata | jq" "$OUT"
fi

OUT=$(il3_input "mcp__codescout__run_command" "cat config.json | jq '.version'" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "allows cat | jq"
else
  fail "allows cat | jq" "$OUT"
fi

# No pipe at all
OUT=$(il3_input "mcp__codescout__run_command" "cargo build" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "allows no-pipe command"
else
  fail "allows no-pipe command" "$OUT"
fi

# Buffer query is the lesson — should pass through
OUT=$(il3_input "mcp__codescout__run_command" "grep ERROR @cmd_abc123" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "allows buffer query (no pipe)"
else
  fail "allows buffer query (no pipe)" "$OUT"
fi

# Non-codescout tool — hook should skip entirely
OUT=$(il3_input "Bash" "cargo test | head" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "skips non-codescout tool"
else
  fail "skips non-codescout tool" "$OUT"
fi

# Empty input
OUT=$(printf '' | node "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then
  pass "empty input: silent exit"
else
  fail "empty input: silent exit" "$OUT"
fi

# Unknown LHS command — hook should not fire (anchored allowlist)
OUT=$(il3_input "mcp__codescout__run_command" "weirdtool --x | head" | node "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "IL3 warning"; then
  pass "allows unknown LHS (anchored allowlist)"
else
  fail "allows unknown LHS" "$OUT"
fi

# --- Aggregators SAVE context (collapse to a summary) — should NOT fire (2026-06-15) ---
for cmd in "git diff HEAD~1 | wc -l" "ls -la | wc -l" "git status --porcelain | wc -l" "git log | grep -c fix" "cargo test | grep --count PASS"; do
  OUT=$(il3_input "mcp__codescout__run_command" "$cmd" | node "$HOOK" 2>/dev/null)
  if ! assert_context_contains "$OUT" "IL3 warning"; then
    pass "allows aggregator: $cmd"
  else
    fail "allows aggregator: $cmd" "$OUT"
  fi
done

# A filtering / context grep still trims and must still fire
for cmd in "git log | grep fix" "cargo test | grep -C 2 warn"; do
  OUT=$(il3_input "mcp__codescout__run_command" "$cmd" | node "$HOOK" 2>/dev/null)
  if assert_context_contains "$OUT" "IL3 warning"; then
    pass "fires on filtering grep: $cmd"
  else
    fail "fires on filtering grep: $cmd" "$OUT"
  fi
done

print_summary "il3-warn-hook"
