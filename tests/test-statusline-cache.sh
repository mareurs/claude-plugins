#!/bin/bash
# tests/test-statusline-cache.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline-cache ──"
COMPOSED="$(dirname "${BASH_SOURCE[0]}")/../buddy/scripts/statusline-composed.sh"

# Isolated CLAUDE_CONFIG_DIR — no creds → no background fetch race
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
trap 'rm -rf "$CLAUDE_CONFIG_DIR"' EXIT
CACHE_FILE="$CLAUDE_CONFIG_DIR/statusline-usage-cache.json"
LOCK_FILE="$CLAUDE_CONFIG_DIR/statusline-usage-cache.lock"

# Minimal CC stdin with no rate_limits
BASE_INPUT='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":10,"context_window_size":200000,"current_usage":{"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"cost":{"total_cost_usd":0,"total_duration_ms":1000,"total_lines_added":0,"total_lines_removed":0}}'

cleanup() {
  rm -f "$CACHE_FILE" "$LOCK_FILE"
}

# ── Test 1: fresh cache data is merged into primary output ──
cleanup
FRESH_TS=$(date +%s)
cat > "$CACHE_FILE" <<EOF
{
  "five_hour":   {"utilization": 42.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "seven_day":   {"utilization": 17.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "fetched_at":  $FRESH_TS,
  "stale":       false,
  "retry_after": 0
}
EOF

OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null)
if echo "$OUT" | grep -q "5h"; then
  pass "fresh cache: rate limits displayed"
else
  fail "fresh cache: rate limits displayed"
fi
if echo "$OUT" | grep -qP "\x1b\[90m~"; then
  fail "fresh cache: no ~ prefix"
else
  pass "fresh cache: no ~ prefix"
fi

# ── Test 2: stale cache shows ~ prefix ──
cleanup
STALE_TS=$(( $(date +%s) - 7200 ))
cat > "$CACHE_FILE" <<EOF
{
  "five_hour":   {"utilization": 88.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "seven_day":   {"utilization": 50.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "fetched_at":  $STALE_TS,
  "stale":       true,
  "retry_after": 0
}
EOF

OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null)
if echo "$OUT" | grep -qP "\x1b\[90m~"; then
  pass "stale cache: ~ prefix shown"
else
  fail "stale cache: ~ prefix shown"
fi

# ── Test 3: no cache file → no rate limits shown, no crash ──
cleanup
OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null)
RC=$?
if [ $RC -eq 0 ]; then pass "no cache: exits 0"; else fail "no cache: exits 0" "exit=$RC"; fi
if echo "$OUT" | grep -qE "5h|7d"; then
  fail "no cache: rate limits hidden"
else
  pass "no cache: rate limits hidden"
fi

# ── Test 4: lock file younger than 30s suppresses concurrent fetch ──
# Verify by placing a lock and a stale cache — no new fetch should occur
cleanup
STALE_TS=$(( $(date +%s) - 7200 ))
cat > "$CACHE_FILE" <<EOF
{
  "five_hour":   {"utilization": 10.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "seven_day":   {"utilization": 5.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "fetched_at":  $STALE_TS,
  "stale":       false,
  "retry_after": 0
}
EOF
touch "$LOCK_FILE"  # fresh lock
OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 BUDDY_SKIP_PRIMARY=1 bash "$COMPOSED" 2>/dev/null)
# cache file fetched_at should NOT have changed (no fetch fired)
NEW_TS=$(jq -r '.fetched_at' "$CACHE_FILE" 2>/dev/null)
if [ "$NEW_TS" = "$STALE_TS" ]; then
  pass "lock: fresh lock suppresses fetch"
else
  fail "lock: fresh lock suppresses fetch" "fetched_at changed to $NEW_TS"
fi

cleanup
print_summary "statusline-cache"
