#!/bin/bash
# tests/test-statusline.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline ──"
STATUSLINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../claude-statusline/bin" && pwd)/statusline.sh"

# Base sample — uses v2.1.97+ field paths
SAMPLE='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"cache_creation_input_tokens":1500,"cache_read_input_tokens":3000}},"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":9999999999},"seven_day":{"used_percentage":5,"resets_at":9999999999}},"rate_limits_stale":false,"cost":{"total_cost_usd":0.15,"total_duration_ms":30000,"total_lines_added":10,"total_lines_removed":3},"workspace":{"git_worktree":{"name":"my-feature","branch":"feat/my-feature"}}}'

SAMPLE_STALE='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"cache_creation_input_tokens":1500,"cache_read_input_tokens":3000}},"rate_limits":{"five_hour":{"used_percentage":55,"resets_at":9999999999},"seven_day":{"used_percentage":30,"resets_at":9999999999}},"rate_limits_stale":true,"cost":{"total_cost_usd":0.15,"total_duration_ms":30000,"total_lines_added":10,"total_lines_removed":3}}'

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

# Test 5: rate limits displayed (fresh)
OUT=$(echo "$SAMPLE" | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -qE "5h"; then pass "fresh rate limits: 5h label shown"; else fail "fresh rate limits: 5h label shown"; fi
if echo "$OUT" | grep -qE "7d"; then pass "fresh rate limits: 7d label shown"; else fail "fresh rate limits: 7d label shown"; fi
# No tilde when fresh
if echo "$OUT" | grep -qP "\x1b\[90m~"; then
  fail "fresh rate limits: no ~ prefix"
else
  pass "fresh rate limits: no ~ prefix"
fi

# Test 6: stale rate limits show ~ prefix
OUT=$(echo "$SAMPLE_STALE" | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -qP "\x1b\[90m~"; then pass "stale rate limits: ~ prefix shown"; else fail "stale rate limits: ~ prefix shown"; fi

# Test 7: worktree name shown when workspace.git_worktree present
OUT=$(echo "$SAMPLE" | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -q "my-feature"; then pass "worktree: name shown"; else fail "worktree: name shown"; fi

# Test 8: multi-worktree warning when fallback `git branch` runs in repo with ≥2 worktrees
TMPREPO=$(mktemp -d)
trap 'rm -rf "$TMPREPO"' EXIT
make_git_repo "$TMPREPO"
make_worktree "$TMPREPO" "$TMPREPO/.worktrees/feat"
# Run statusline from inside the main repo with NO worktree field — forces fallback
OUT=$(cd "$TMPREPO" && echo '{"model":{"display_name":"m"}}' | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -qE '·[0-9]+wt'; then
  pass "multi-worktree fallback: warning suffix appended"
else
  fail "multi-worktree fallback: warning suffix appended" "$OUT"
fi

# Test 9: no warning in single-worktree repo
SOLO=$(mktemp -d)
make_git_repo "$SOLO"
OUT=$(cd "$SOLO" && echo '{"model":{"display_name":"m"}}' | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -qE '·[0-9]+wt'; then
  fail "single-worktree: no warning" "$OUT"
else
  pass "single-worktree: no warning"
fi
rm -rf "$SOLO"

# Test 10: profile badge — derived from CLAUDE_CONFIG_DIR
for pair in ".claude-sdd|sdd" ".claude-kat|kat" ".claude|claude"; do
  IFS='|' read -r cfg label <<< "$pair"
  OUT=$(CLAUDE_CONFIG_DIR="/home/x/$cfg" echo '{"model":{"display_name":"m"}}' | CLAUDE_CONFIG_DIR="/home/x/$cfg" bash "$STATUSLINE" 2>/dev/null)
  if echo "$OUT" | grep -q " $label "; then
    pass "profile badge: $cfg → $label"
  else
    fail "profile badge: $cfg → $label" "$OUT"
  fi
done

# Test 11: effort level — drawn inside the model badge, right after the model name.
# Escapes are stripped so the assertion is about order and text, not colour.
strip_ansi() { sed -e 's/\x1b\[[0-9;]*m//g' -e 's/\\033\[[0-9;]*m//g'; }
EFFORT_BASE='"model":{"display_name":"test-model"}'
for lvl in low medium high xhigh max; do
  OUT=$(echo "{$EFFORT_BASE,\"effort\":{\"level\":\"$lvl\"}}" | bash "$STATUSLINE" 2>/dev/null | strip_ansi)
  if echo "$OUT" | grep -qE "^ ?test-model · $lvl( |$)"; then
    pass "effort: $lvl shown right after the model name"
  else
    fail "effort: $lvl shown right after the model name" "$OUT"
  fi
done

# Test 12: effort absent (model without an effort setting) — nothing extra, no placeholder
for payload in "{$EFFORT_BASE}" "{$EFFORT_BASE,\"effort\":null}" "{$EFFORT_BASE,\"effort\":{\"level\":\"\"}}"; do
  OUT=$(echo "$payload" | bash "$STATUSLINE" 2>/dev/null | strip_ansi)
  if echo "$OUT" | grep -qE "^ ?test-model ·"; then
    fail "effort absent: no effort text ($payload)" "$OUT"
  else
    pass "effort absent: no effort text"
  fi
  if echo "$OUT" | grep -q "test-model"; then
    pass "effort absent: model name still shown"
  else
    fail "effort absent: model name still shown" "$OUT"
  fi
done

# Test 13: with an agent badge, effort stays attached to the model, before the agent
OUT=$(echo "{$EFFORT_BASE,\"effort\":{\"level\":\"high\"},\"agent\":{\"name\":\"reviewer\"}}" | bash "$STATUSLINE" 2>/dev/null | strip_ansi)
if echo "$OUT" | grep -qE "test-model · high.*reviewer"; then
  pass "effort: sits before the agent badge"
else
  fail "effort: sits before the agent badge" "$OUT"
fi

# Test 14: effort does not shift the later fields (field-count guard)
OUT=$(echo "$SAMPLE" | jq -c '. + {effort:{level:"xhigh"}}' | bash "$STATUSLINE" 2>/dev/null | strip_ansi)
if echo "$OUT" | grep -q "ctx 42%" && echo "$OUT" | grep -q "my-feature"; then
  pass "effort: ctx and worktree fields still read correctly"
else
  fail "effort: ctx and worktree fields still read correctly" "$OUT"
fi

print_summary "statusline"
