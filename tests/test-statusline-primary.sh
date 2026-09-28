#!/bin/bash
# tests/test-statusline-primary.sh — resolve_primary lookup order.
#
# The primary (row 1) used to resolve only from the claude-statusline plugin
# cache. No profile has an install record for claude-statusline, so Claude
# Code's orphan sweep deleted that cache dir from ~/.claude-sdd and row 1
# silently degraded to the rate-limits fallback. The sibling claude-statusline
# in the same checkout is now tried first; cache and $cfg/statusline.sh remain
# as fallbacks.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline-primary ──"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_COMPOSED="$REPO_ROOT/buddy/scripts/statusline-composed.sh"

BASE_INPUT='{"model":{"display_name":"test-model"},"context_window":{"used_percentage":10,"context_window_size":200000}}'

# Fresh sandbox per test: a checkout-shaped tree holding a copy of the composed
# script, plus an empty CLAUDE_CONFIG_DIR (no creds → no background fetch).
SANDBOX=""
new_sandbox() {
  [ -n "$SANDBOX" ] && rm -rf "$SANDBOX"
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/checkout/buddy/scripts" "$SANDBOX/config"
  cp "$REAL_COMPOSED" "$SANDBOX/checkout/buddy/scripts/"
  export CLAUDE_CONFIG_DIR="$SANDBOX/config"
}
trap '[ -n "$SANDBOX" ] && rm -rf "$SANDBOX"' EXIT

# stub <path> <marker> — an executable primary that prints <marker>
stub() {
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/bash\ncat >/dev/null\necho %s\n' "$2" > "$1"
  chmod +x "$1"
}
add_sibling() { stub "$SANDBOX/checkout/claude-statusline/bin/statusline.sh" SIBLING-PRIMARY; }
add_cache()   { stub "$CLAUDE_CONFIG_DIR/plugins/cache/sdd-misc-plugins/claude-statusline/9.9.9/bin/statusline.sh" CACHE-PRIMARY; }

render() {
  echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$SANDBOX/checkout/buddy/scripts/statusline-composed.sh" 2>/dev/null
}

# ── Test 1: sibling in the same checkout is used when no cache exists ──
new_sandbox; add_sibling
OUT=$(render)
if echo "$OUT" | grep -q SIBLING-PRIMARY; then
  pass "sibling: used when cache is absent"
else
  fail "sibling: used when cache is absent" "got: $OUT"
fi

# ── Test 2: sibling wins over the plugin cache ──
new_sandbox; add_sibling; add_cache
OUT=$(render)
if echo "$OUT" | grep -q SIBLING-PRIMARY && ! echo "$OUT" | grep -q CACHE-PRIMARY; then
  pass "sibling: preferred over plugin cache"
else
  fail "sibling: preferred over plugin cache" "got: $OUT"
fi

# ── Test 3: no sibling → plugin cache still resolves ──
new_sandbox; add_cache
OUT=$(render)
if echo "$OUT" | grep -q CACHE-PRIMARY; then
  pass "cache: used when no sibling exists"
else
  fail "cache: used when no sibling exists" "got: $OUT"
fi

# ── Test 4: BUDDY_PRIMARY_STATUSLINE overrides the sibling ──
new_sandbox; add_sibling
stub "$SANDBOX/env-primary.sh" ENV-PRIMARY
OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 BUDDY_PRIMARY_STATUSLINE="$SANDBOX/env-primary.sh" \
  bash "$SANDBOX/checkout/buddy/scripts/statusline-composed.sh" 2>/dev/null)
if echo "$OUT" | grep -q ENV-PRIMARY && ! echo "$OUT" | grep -q SIBLING-PRIMARY; then
  pass "env: BUDDY_PRIMARY_STATUSLINE overrides sibling"
else
  fail "env: BUDDY_PRIMARY_STATUSLINE overrides sibling" "got: $OUT"
fi

# ── Test 5: non-executable sibling is skipped ──
new_sandbox; add_sibling; add_cache
chmod -x "$SANDBOX/checkout/claude-statusline/bin/statusline.sh"
OUT=$(render)
if echo "$OUT" | grep -q CACHE-PRIMARY; then
  pass "sibling: non-executable falls through to cache"
else
  fail "sibling: non-executable falls through to cache" "got: $OUT"
fi

# ── Test 6: the real repo layout resolves the real claude-statusline ──
# Guards the relative path against the actual tree: the fallback never prints
# the model name, the primary always does.
new_sandbox
OUT=$(echo "$BASE_INPUT" | BUDDY_SKIP_SELF=1 bash "$REAL_COMPOSED" 2>/dev/null)
if echo "$OUT" | grep -q "test-model"; then
  pass "repo layout: real claude-statusline renders row 1"
else
  fail "repo layout: real claude-statusline renders row 1" "got: $OUT"
fi

print_summary "statusline-primary"
