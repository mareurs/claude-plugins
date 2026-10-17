#!/bin/bash
# tests/test-statusline-cache.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline-cache ──"

# Isolated CLAUDE_CONFIG_DIR — no creds → no background fetch race
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
# Run a copy of the composed script from a sandbox with no claude-statusline
# beside it, so resolve_primary finds nothing and these tests exercise the
# rate-limits fallback. Run from the repo, the sibling lookup would find the
# real claude-statusline and the fallback would be tested nowhere.
SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX/buddy/scripts"
cp "$(dirname "${BASH_SOURCE[0]}")/../buddy/scripts/statusline-composed.sh" "$SANDBOX/buddy/scripts/"
COMPOSED="$SANDBOX/buddy/scripts/statusline-composed.sh"
trap 'rm -rf "$CLAUDE_CONFIG_DIR" "$SANDBOX"' EXIT
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
# The values, not just the labels: _merge_cache renames utilization to
# used_percentage, and a fallback reading the old key printed 100%/100%.
PLAIN=$(echo "$OUT" | sed 's/\x1b\[[0-9;]*m//g')
if echo "$PLAIN" | grep -qF "5h 42%/7d 17%"; then
  pass "fresh cache: fallback shows cached percentages"
else
  fail "fresh cache: fallback shows cached percentages" "got: $PLAIN"
fi

# ── Test 1b: 0% utilization renders as 0%, not 100% ──
cleanup
cat > "$CACHE_FILE" <<EOF
{
  "five_hour":   {"utilization": 0.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "seven_day":   {"utilization": 49.0, "resets_at": "2099-01-01T00:00:00.000000+00:00"},
  "fetched_at":  $FRESH_TS,
  "stale":       false,
  "retry_after": 0
}
EOF
PLAIN=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')
if echo "$PLAIN" | grep -qF "5h 0%/7d 49%"; then
  pass "zero utilization: fallback shows 0%"
else
  fail "zero utilization: fallback shows 0%" "got: $PLAIN"
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

# ── Tests 5-7: credentials file present but accessToken empty ──
# A profile logged in with a long-lived CLAUDE_CODE_OAUTH_TOKEN has an empty
# .credentials.json. _fetch_usage returns before it can mark the cache stale,
# so an old cache kept showing as current. With no token the cache can never
# refresh, so it must not be merged.
CREDS_FILE="$CLAUDE_CONFIG_DIR/.credentials.json"
OLD_CACHE_BODY='{"five_hour":{"utilization":46.0,"resets_at":"2099-01-01T00:00:00.000000+00:00"},"seven_day":{"utilization":78.0,"resets_at":"2099-01-01T00:00:00.000000+00:00"},"fetched_at":'"$FRESH_TS"',"stale":false,"retry_after":0}'

# Test 5: empty accessToken + cache present → cached numbers hidden
cleanup
echo '{"claudeAiOauth":{"accessToken":"","refreshToken":"","expiresAt":0}}' > "$CREDS_FILE"
echo "$OLD_CACHE_BODY" > "$CACHE_FILE"
PLAIN=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')
if echo "$PLAIN" | grep -qE "5h|7d"; then
  fail "empty token: cached usage hidden" "got: $PLAIN"
else
  pass "empty token: cached usage hidden"
fi

# Test 6: native rate_limits from CC stdin survive an empty token
NATIVE_INPUT=$(echo "$BASE_INPUT" | jq -c '. + {rate_limits:{five_hour:{used_percentage:33,resets_at:4070908800},seven_day:{used_percentage:61,resets_at:4070908800}}}')
PLAIN=$(echo "$NATIVE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')
if echo "$PLAIN" | grep -qF "5h 33%/7d 61%"; then
  pass "empty token: native rate_limits kept"
else
  fail "empty token: native rate_limits kept" "got: $PLAIN"
fi

# Test 7: non-empty accessToken → cache still merged (no over-hiding).
# Cache is fresh (<5m), so no background fetch fires with the fake token.
cleanup
echo '{"claudeAiOauth":{"accessToken":"test-token","refreshToken":"x","expiresAt":4070908800000}}' > "$CREDS_FILE"
echo "$OLD_CACHE_BODY" > "$CACHE_FILE"
PLAIN=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$COMPOSED" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')
if echo "$PLAIN" | grep -qF "5h 46%/7d 78%"; then
  pass "valid token: cached usage still shown"
else
  fail "valid token: cached usage still shown" "got: $PLAIN"
fi
rm -f "$CREDS_FILE"

cleanup
print_summary "statusline-cache"
