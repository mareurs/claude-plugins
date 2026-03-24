#!/bin/bash
# tests/test-statusline.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline ──"
STATUSLINE="$(dirname "${BASH_SOURCE[0]}")/../claude-statusline/bin/statusline.sh"

SAMPLE='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":42,"current_usage":{"cache_creation_input_tokens":1500,"cache_read_input_tokens":3000}},"rate_limits":{"five_hour":{"used_percentage":10},"seven_day":{"used_percentage":5}},"cost":{"total_cost_usd":0.15,"total_duration_ms":30000,"total_lines_added":10,"total_lines_removed":3},"agent":{},"worktree":{}}'

# Test 1: valid JSON produces exit 0 and non-empty output
OUT=$(echo "$SAMPLE" | bash "$STATUSLINE" 2>/dev/null)
RC=$?
if [ $RC -eq 0 ]; then pass "valid JSON: exit 0"; else fail "valid JSON: exit 0" "exit=$RC"; fi
if [ -n "$OUT" ]; then pass "valid JSON: non-empty output"; else fail "valid JSON: non-empty output"; fi

# Test 2: output contains model name
if echo "$OUT" | grep -q "test-model"; then pass "output contains model name"; else fail "output contains model name"; fi

# Test 3: empty JSON exits 0
OUT=$(echo '{}' | bash "$STATUSLINE" 2>/dev/null)
RC=$?
if [ $RC -eq 0 ]; then pass "empty JSON: exit 0"; else fail "empty JSON: exit 0" "exit=$RC"; fi

# Test 4: malformed input exits 0
OUT=$(echo 'not json' | bash "$STATUSLINE" 2>/dev/null)
RC=$?
if [ $RC -eq 0 ]; then pass "malformed input: exit 0"; else fail "malformed input: exit 0" "exit=$RC"; fi

print_summary "statusline"
