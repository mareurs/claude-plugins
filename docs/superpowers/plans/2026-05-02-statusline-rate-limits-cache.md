# Statusline: Rate Limits Cache + Field Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore rate limit display in the statusline by caching `/api/oauth/usage` (max once/hour, shared across both CC instances) and fix dead stdin field paths introduced by CC v2.1.97–v2.1.126.

**Architecture:** `statusline-composed.sh` (the orchestrator) owns all network I/O — it reads/refreshes a shared cache file, merges rate limit data into the CC stdin JSON, then pipes the merged payload to `statusline.sh`. `statusline.sh` remains a pure stdin reader; the only changes there are field path fixes and a `~` stale marker.

**Tech Stack:** bash, jq, curl — no new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `claude-statusline/bin/statusline.sh` | Fix `.worktree.*` → `.workspace.git_worktree.*`; add `rate_limits_stale` field; render `~` prefix when stale |
| `buddy/scripts/statusline-composed.sh` | Add cache read / fetch / merge block before primary render |
| `tests/test-statusline.sh` | Update SAMPLE fixture; add stale/worktree tests |

Cache files (not in repo, created at runtime):
- `~/.claude/statusline-usage-cache.json` — persisted rate limit data
- `~/.claude/statusline-usage-cache.lock` — prevents concurrent fetches

---

## Task 1: Update tests + fix field paths in statusline.sh

**Files:**
- Modify: `tests/test-statusline.sh`
- Modify: `claude-statusline/bin/statusline.sh`

### Step 1: Run existing tests — note current state

```bash
bash tests/test-statusline.sh
```

Expected: all pass (baseline before changes).

### Step 2: Update SAMPLE fixture and add new failing tests

Replace the entire `tests/test-statusline.sh` with:

```bash
#!/bin/bash
# tests/test-statusline.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline ──"
STATUSLINE="$(dirname "${BASH_SOURCE[0]}")/../claude-statusline/bin/statusline.sh"

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

print_summary "statusline"
```

### Step 3: Run tests — verify new tests fail

```bash
bash tests/test-statusline.sh
```

Expected: tests 5–7 fail (field paths not yet updated, `~` not yet rendered).

### Step 4: Update jq extraction block in statusline.sh

Replace the `jq_out` block and field assignments (lines 18–62 of `statusline.sh`):

```bash
# -- Extract all fields in one jq call (one field per line) --
jq_out="$(echo "$input" | jq -r '
  (.model.display_name // ""),
  (.context_window.used_percentage // ""),
  (.context_window.context_window_size // ""),
  (.rate_limits.five_hour.used_percentage // ""),
  (.rate_limits.five_hour.resets_at // ""),
  (.rate_limits.seven_day.used_percentage // ""),
  (.rate_limits.seven_day.resets_at // ""),
  (.cost.total_cost_usd // 0),
  (.cost.total_duration_ms // 0),
  (.cost.total_lines_added // 0),
  (.cost.total_lines_removed // 0),
  (.context_window.current_usage.cache_creation_input_tokens // ""),
  (.context_window.current_usage.cache_read_input_tokens // ""),
  (.agent.name // ""),
  (.workspace.git_worktree.name // ""),
  (.workspace.git_worktree.branch // ""),
  (if .rate_limits_stale == true then "true" else "false" end),
  "END"
' 2>/dev/null)" || exit 0

readarray -t F <<< "$jq_out"

# Bail if jq produced insufficient output (18 fields: 17 data + sentinel)
[[ ${#F[@]} -ge 18 ]] || exit 0

MODEL="${F[0]}"
CTX_PCT="${F[1]}"
CTX_SIZE="${F[2]}"
RATE_5H="${F[3]}"
RATE_5H_RESET="${F[4]}"
RATE_7D="${F[5]}"
RATE_7D_RESET="${F[6]}"
COST_USD="${F[7]}"
DURATION_MS="${F[8]}"
LINES_ADD="${F[9]}"
LINES_DEL="${F[10]}"
CACHE_CREATE="${F[11]}"
CACHE_READ="${F[12]}"
AGENT_NAME="${F[13]}"
WT_NAME="${F[14]}"
WT_BRANCH="${F[15]}"
RATE_STALE="${F[16]}"
```

### Step 5: Add stale prefix rendering in the rate limits section

Find the rate limits rendering block (the `rate_seg` section) and replace it with:

```bash
# Rate limits
rate_seg=""
if [[ -n "$RATE_5H" ]] || [[ -n "$RATE_7D" ]]; then
  if [[ "$RATE_STALE" == "true" ]]; then
    stale_pfx="${DIM}~${RST}"
  else
    stale_pfx=""
  fi
fi
if [[ -n "$RATE_5H" ]]; then
  r5_int=$(int_pct "$RATE_5H")
  c=$(color_pct "$r5_int")
  r5_remain=$(format_remaining "$RATE_5H_RESET")
  rate_seg+="${DIM}5h${RST} ${stale_pfx}${c}${r5_int}%${RST}"
  if [[ -n "$r5_remain" ]]; then
    rate_seg+="${DIM}(${r5_remain})${RST}"
  fi
fi
if [[ -n "$RATE_5H" && -n "$RATE_7D" ]]; then
  rate_seg+="${DIM}/${RST}"
fi
if [[ -n "$RATE_7D" ]]; then
  r7_int=$(int_pct "$RATE_7D")
  c=$(color_pct "$r7_int")
  r7_remain=$(format_remaining "$RATE_7D_RESET")
  rate_seg+="${DIM}7d${RST} ${stale_pfx}${c}${r7_int}%${RST}"
  if [[ -n "$r7_remain" ]]; then
    rate_seg+="${DIM}(${r7_remain})${RST}"
  fi
fi
if [[ -n "$rate_seg" ]]; then
  out+="${SEP}${rate_seg}"
fi
```

### Step 6: Update version comment at top of statusline.sh

Change line 2:

```bash
# claude-statusline v1.0.3
```

(was v1.0.2 — bump patch for field migration)

### Step 7: Run tests — verify all pass

```bash
bash tests/test-statusline.sh
```

Expected: all 7 tests pass.

### Step 8: Commit

```bash
git add claude-statusline/bin/statusline.sh tests/test-statusline.sh
git commit -m "fix(statusline): migrate to v2.1.97+ field paths; add stale ~ marker"
```

---

## Task 2: Add cache fetch/merge to statusline-composed.sh

**Files:**
- Modify: `buddy/scripts/statusline-composed.sh`

### Step 1: Write a test for cache merge behaviour

Create `tests/test-statusline-cache.sh`:

```bash
#!/bin/bash
# tests/test-statusline-cache.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── statusline-cache ──"
COMPOSED="$(dirname "${BASH_SOURCE[0]}")/../buddy/scripts/statusline-composed.sh"

CACHE_FILE="$HOME/.claude/statusline-usage-cache.json"
LOCK_FILE="$HOME/.claude/statusline-usage-cache.lock"

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
  "five_hour":   {"used_percentage": 42, "resets_at": 9999999999},
  "seven_day":   {"used_percentage": 17, "resets_at": 9999999999},
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
  "five_hour":   {"used_percentage": 88, "resets_at": 9999999999},
  "seven_day":   {"used_percentage": 50, "resets_at": 9999999999},
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
  "five_hour":   {"used_percentage": 10, "resets_at": 9999999999},
  "seven_day":   {"used_percentage": 5, "resets_at": 9999999999},
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
```

### Step 2: Register the new test in run-all.sh

Open `tests/run-all.sh` and add the new test file. Find the line that runs `test-statusline.sh` and add after it:

```bash
bash "$(dirname "$0")/test-statusline-cache.sh"
```

### Step 3: Run new tests — verify they fail

```bash
bash tests/test-statusline-cache.sh
```

Expected: tests 1–4 fail (cache logic not yet in composed script).

### Step 4: Add cache functions + merge to statusline-composed.sh

Replace the entire `buddy/scripts/statusline-composed.sh` with:

```bash
#!/usr/bin/env bash
# Buddy composed statusline.
#
# Runs a "primary" statusline command (e.g. claude-statusline) on row 1,
# then the buddy bodhisattva on the following rows — both fed the same
# stdin JSON from Claude Code.
#
# Each component remains independently usable; this wrapper just stacks them.
#
# Configuration (all optional):
#   BUDDY_PRIMARY_STATUSLINE  Path to a primary statusline command. If unset,
#                             the script tries to find claude-statusline from
#                             the sdd-misc-plugins cache, then falls back to
#                             $HOME/.claude/statusline.sh, then to nothing.
#   BUDDY_SKIP_PRIMARY=1      Skip the primary entirely (buddy only).
#   BUDDY_SKIP_SELF=1         Skip the buddy row (primary only — rarely useful).

set -u

# -- Read stdin once so we can fan it out --
INPUT=$(cat)

# ── Rate limit cache ─────────────────────────────────────────────────────────
# Credentials and cache always live in ~/.claude/ regardless of which CC
# instance (main or sdd) is running — both share the same OAuth account.

_CREDS="$HOME/.claude/.credentials.json"
_CACHE="$HOME/.claude/statusline-usage-cache.json"
_LOCK="$HOME/.claude/statusline-usage-cache.lock"

_fetch_usage() {
  command -v curl &>/dev/null || return
  command -v jq   &>/dev/null || return
  [[ -f "$_CREDS" ]] || return

  local token
  token=$(jq -r '.claudeAiOauth.accessToken // empty' "$_CREDS" 2>/dev/null)
  [[ -z "$token" ]] && return

  local now body_file header_file http_code retry_secs body
  now=$(date +%s)
  body_file=$(mktemp)
  header_file=$(mktemp)

  http_code=$(curl -s -o "$body_file" -D "$header_file" -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    "https://api.anthropic.com/api/oauth/usage" 2>/dev/null) || http_code="0"

  body=$(cat "$body_file" 2>/dev/null)
  retry_secs=$(grep -i "^retry-after:" "$header_file" 2>/dev/null \
    | tr -d '\r' | awk '{print $2}' | grep -E '^[0-9]+$' || echo "3600")
  [[ -z "$retry_secs" ]] && retry_secs=3600
  rm -f "$body_file" "$header_file"

  local tmp
  tmp=$(mktemp)

  if [[ "$http_code" == "200" ]]; then
    echo "$body" | jq --argjson now "$now" \
      '. + {fetched_at: $now, stale: false, retry_after: 0}' \
      > "$tmp" 2>/dev/null && mv "$tmp" "$_CACHE"

  elif [[ "$http_code" == "429" ]]; then
    local retry_at=$(( now + retry_secs ))
    if [[ -f "$_CACHE" ]]; then
      jq --argjson now "$now" --argjson ra "$retry_at" \
        '. + {fetched_at: $now, stale: true, retry_after: $ra}' \
        "$_CACHE" > "$tmp" 2>/dev/null && mv "$tmp" "$_CACHE"
    else
      jq -n --argjson now "$now" --argjson ra "$retry_at" \
        '{fetched_at: $now, stale: true, retry_after: $ra}' \
        > "$_CACHE" 2>/dev/null
    fi
    rm -f "$tmp"

  else
    # Network failure or unexpected status — mark stale, retry in 1h
    if [[ -f "$_CACHE" ]]; then
      jq --argjson now "$now" \
        '. + {fetched_at: $now, stale: true, retry_after: 0}' \
        "$_CACHE" > "$tmp" 2>/dev/null && mv "$tmp" "$_CACHE"
    else
      jq -n --argjson now "$now" \
        '{fetched_at: $now, stale: true, retry_after: 0}' \
        > "$_CACHE" 2>/dev/null
    fi
    rm -f "$tmp"
  fi
}

_maybe_refresh_cache() {
  command -v jq &>/dev/null || return

  local now fetched_at retry_after cache_age
  now=$(date +%s)
  fetched_at=0
  retry_after=0

  if [[ -f "$_CACHE" ]]; then
    fetched_at=$(jq -r '.fetched_at // 0' "$_CACHE" 2>/dev/null || echo 0)
    retry_after=$(jq -r '.retry_after // 0' "$_CACHE" 2>/dev/null || echo 0)
  fi

  cache_age=$(( now - fetched_at ))
  (( cache_age < 3600 )) && return   # Fresh — no refresh needed
  (( now <= retry_after )) && return  # 429-blocked — honour retry_after

  # Acquire lock — skip if another render is mid-fetch (lock < 30s old)
  if [[ -f "$_LOCK" ]]; then
    local lock_mtime lock_age
    lock_mtime=$(stat -c %Y "$_LOCK" 2>/dev/null || echo 0)
    lock_age=$(( now - lock_mtime ))
    (( lock_age < 30 )) && return
  fi

  touch "$_LOCK" 2>/dev/null
  _fetch_usage
  rm -f "$_LOCK"
}

_merge_cache() {
  command -v jq &>/dev/null || { echo "$INPUT"; return; }
  [[ -f "$_CACHE" ]] || { echo "$INPUT"; return; }

  local merged
  merged=$(jq -s '
    .[0] + {
      rate_limits: {
        five_hour: .[1].five_hour,
        seven_day:  .[1].seven_day
      },
      rate_limits_stale: (.[1].stale // false)
    }
  ' <(echo "$INPUT") "$_CACHE" 2>/dev/null)

  echo "${merged:-$INPUT}"
}

# Run cache refresh (non-blocking: skip if locked) then merge into INPUT
_maybe_refresh_cache
INPUT=$(_merge_cache)

# ── Resolve primary statusline command ───────────────────────────────────────

resolve_primary() {
  if [[ -n "${BUDDY_PRIMARY_STATUSLINE:-}" ]]; then
    printf '%s' "$BUDDY_PRIMARY_STATUSLINE"
    return
  fi

  local cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  local candidate
  for candidate in "$cfg"/plugins/cache/sdd-misc-plugins/claude-statusline/*/bin/statusline.sh; do
    [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return; }
  done

  if [[ -x "$HOME/.claude/statusline.sh" ]]; then
    printf '%s' "$HOME/.claude/statusline.sh"
    return
  fi

  printf ''
}

# ── Render primary ───────────────────────────────────────────────────────────

if [[ "${BUDDY_SKIP_PRIMARY:-0}" != "1" ]]; then
  PRIMARY=$(resolve_primary)
  if [[ -n "$PRIMARY" ]]; then
    printf '%s' "$INPUT" | "$PRIMARY" 2>/dev/null || true
    echo
  fi
fi

# ── Render buddy ─────────────────────────────────────────────────────────────

if [[ "${BUDDY_SKIP_SELF:-0}" != "1" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  printf '%s' "$INPUT" | python3 "$SELF_DIR/statusline.py" 2>/dev/null || true
fi

# ── Render caveman badge ──────────────────────────────────────────────────────

CAVEMAN_FLAG="$HOME/.claude/.caveman-active"
if [[ -f "$CAVEMAN_FLAG" ]]; then
  CAVEMAN_MODE=$(cat "$CAVEMAN_FLAG" 2>/dev/null)
  if [[ "$CAVEMAN_MODE" == "full" ]] || [[ -z "$CAVEMAN_MODE" ]]; then
    printf ' \033[38;5;172m[CAVEMAN]\033[0m'
  else
    printf ' \033[38;5;172m[CAVEMAN:%s]\033[0m' \
      "$(echo "$CAVEMAN_MODE" | tr '[:lower:]' '[:upper:]')"
  fi
  echo
fi
```

### Step 5: Run tests — verify all pass

```bash
bash tests/test-statusline-cache.sh
```

Expected: all 4 tests pass.

### Step 6: Run full test suite

```bash
bash tests/run-all.sh
```

Expected: all tests pass.

### Step 7: Commit

```bash
git add buddy/scripts/statusline-composed.sh tests/test-statusline-cache.sh tests/run-all.sh
git commit -m "feat(statusline): rate limit cache — once/hour fetch via /api/oauth/usage"
```

---

## Task 3: Version bump + install record update

**Files:**
- Modify: `buddy/.claude-plugin/plugin.json`
- Modify: `README.md`
- Modify: `~/.claude/plugins/installed_plugins.json`
- Modify: `~/.claude-sdd/plugins/installed_plugins.json`

### Step 1: Check current buddy version

```bash
cat buddy/.claude-plugin/plugin.json | jq '.version'
```

Expected: `"0.2.0"` (or current version).

### Step 2: Bump buddy version to 0.3.0

In `buddy/.claude-plugin/plugin.json`, change:

```json
"version": "0.3.0"
```

### Step 3: Update README.md version table

Find the buddy row in the version table and update it to `0.3.0`.

### Step 4: Run version consistency check

```bash
bash scripts/check-versions.sh
```

Expected: passes with no errors.

### Step 5: Commit version bump

```bash
git add buddy/.claude-plugin/plugin.json README.md
git commit -m "chore(buddy): bump to 0.3.0 — statusline rate limits cache"
```

### Step 6: Update both installed_plugins.json records

Check the latest cache path:

```bash
ls ~/.claude/plugins/cache/sdd-misc-plugins/buddy/
ls ~/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/
```

In both `~/.claude/plugins/installed_plugins.json` and `~/.claude-sdd/plugins/installed_plugins.json`, find the buddy entry and update:

```json
"installPath": "~/.claude/plugins/cache/sdd-misc-plugins/buddy/0.3.0",
"version": "0.3.0"
```

(Use the actual full path returned by the `ls` above.)

### Step 7: Push and restart both CC instances

```bash
git push
```

Then restart both `~/.claude` and `~/.claude-sdd` Claude Code instances.

### Step 8: Verify manually

After restart, check the statusline shows rate limits. If still 429-blocked (~52 min window), wait for `retry_after` to expire — verify by checking:

```bash
cat ~/.claude/statusline-usage-cache.json | jq '{stale, retry_after, fetched_at}'
```

Once unblocked, the next statusline render will fetch fresh data and display `5h X% | 7d Y%` without `~`.
