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
  ( _fetch_usage; rm -f "$_LOCK" ) &>/dev/null &
  disown 2>/dev/null || true
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
