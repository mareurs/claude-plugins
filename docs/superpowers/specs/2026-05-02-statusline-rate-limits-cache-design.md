# Statusline: Rate Limits Cache + Field Migration

**Date:** 2026-05-02
**Status:** Approved

## Background

Claude Code v2.1.80 added `rate_limits` (five_hour, seven_day) to the statusLine stdin JSON.
v2.1.126 silently removed it — the internal `/api/oauth/usage` polling caused widespread 429s
(GH #31637). The field `worktree` (top-level) was also replaced by `workspace.git_worktree`
in v2.1.97 without removing the old path, now the old path is gone.

## Goals

1. Restore rate limit display by fetching `/api/oauth/usage` at most once per hour across all
   statusline renders and all Claude Code instances.
2. Fix dead stdin field paths (`worktree.*` → `workspace.git_worktree.*`).
3. Show stale rate limit data (with `~` marker) when the API is unavailable.

## Architecture

```
CC stdin JSON
      │
      ▼
statusline-composed.sh
  1. Read ~/.claude/statusline-usage-cache.json
  2. If stale (age ≥ 1h) and not 429-blocked: fetch API → update cache
  3. Merge .rate_limits from cache into stdin JSON (jq -s)
  4. Pipe merged JSON → statusline.sh (unchanged fetch logic)
      │
      ▼
statusline.sh (reads .rate_limits.* as before; renders ~ prefix when stale)
```

`statusline.sh` remains a pure stdin reader. All network I/O lives in `statusline-composed.sh`.

## Cache File

**Path:** `~/.claude/statusline-usage-cache.json`
Shared across both CC instances — `~/.claude/` and `~/.claude-sdd/` both read OAuth
credentials from `~/.claude/.credentials.json`, so one cache file serves both.
A render from either instance hitting the cache prevents the other from re-fetching.

```json
{
  "five_hour":   { "used_percentage": 45.2, "resets_at": 1714567890 },
  "seven_day":   { "used_percentage": 23.1, "resets_at": 1714999890 },
  "fetched_at":  1714564290,
  "stale":       false,
  "retry_after": 0
}
```

- `fetched_at`: unix epoch of last fetch attempt (success or failure)
- `stale`: true when last fetch failed; drives `~` marker in display
- `retry_after`: unix epoch; when non-zero, suppress fetch until `now > retry_after`

## Fetch Logic (`statusline-composed.sh`)

### Inputs
- OAuth access token from `~/.claude/.credentials.json` (`.claudeAiOauth.accessToken`)
  — hardcoded to `~/.claude/` (not `$CLAUDE_CONFIG_DIR`); credentials are always there
  regardless of which instance (`~/.claude/` or `~/.claude-sdd/`) is running.
- Endpoint: `GET https://api.anthropic.com/api/oauth/usage`
- Headers: `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`

### Decision tree

```
cache_age = now - fetched_at
need_refresh = (cache_age >= 3600) AND (now > retry_after)

if need_refresh:
  if lock exists AND lock_age < 30s:
    skip (another render is mid-fetch)
  else:
    touch ~/.claude/statusline-usage-cache.lock
    response = curl ...
    if HTTP 200:
      write cache: data + fetched_at=now + stale=false + retry_after=0
    elif HTTP 429:
      write cache: keep old data + fetched_at=now + stale=true +
                   retry_after = now + Retry-After header (default 3600 if missing)
    else (network error / other):
      write cache: keep old data + fetched_at=now + stale=true + retry_after=0
    rm lock
```

Lock file: `~/.claude/statusline-usage-cache.lock`
Lock age > 30s = stale lock (crashed render), safe to override.

### Merge step

```bash
merged=$(jq -s '.[0] * {"rate_limits": (.[1] | {five_hour, seven_day}), "rate_limits_stale": .[1].stale}' \
  <(echo "$INPUT") \
  ~/.claude/statusline-usage-cache.json)
```

The merged JSON is piped to `statusline.sh`. Field paths remain `.rate_limits.five_hour.*`
and `.rate_limits.seven_day.*` — identical to what CC provided natively.

## Field Migrations (`statusline.sh`)

| Field | Old path | New path |
|-------|----------|----------|
| Worktree name | `.worktree.name` | `.workspace.git_worktree.name` |
| Worktree branch | `.worktree.branch` | `.workspace.git_worktree.branch` |
| Agent name | `.agent.name` | `.agent.name` (unchanged — still present in subagent sessions) |
| Rate limits | `.rate_limits.*` (CC-native) | `.rate_limits.*` (injected by composed) |

### Staleness display

New jq field extracted: `.rate_limits_stale` (boolean).

When `rate_limits_stale = true`, prefix both rate limit values with dim `~`:
```
5h ~45% | 7d ~23%   ← stale
5h 45%  | 7d 23%    ← fresh
```

The `~` is rendered in the same dim color as the `5h`/`7d` labels.

## Files Changed

| File | Change |
|------|--------|
| `claude-statusline/bin/statusline.sh` | Fix worktree paths; extract `rate_limits_stale`; add `~` prefix rendering |
| `buddy/scripts/statusline-composed.sh` | Add cache read/fetch/merge block (~50 lines) |

No new files. Cache + lock live at `~/.claude/` (not tracked in this repo).

## Error Handling

- `jq` missing: statusline already handles this (early exit with error message).
- `curl` missing: skip fetch entirely; display stale data if cache exists, hide rate limits otherwise.
- Credentials file missing: skip fetch, hide rate limits.
- Cache file missing on first run: treat as fully stale; attempt fetch immediately.
- Malformed cache JSON: treat as missing.

## Testing

Manual verification steps (no automated test needed — cache behavior is environment-dependent):

1. Cold start (no cache): rate limits hidden or show fresh fetch.
2. Fresh cache (age < 1h): no API call made, values displayed without `~`.
3. Stale cache (age ≥ 1h, API reachable): fresh fetch, values displayed without `~`.
4. Stale cache + 429: values displayed with `~`, retry_after respected.
5. Stale cache + network error: values displayed with `~`, retries after 1h.
6. Concurrent renders: only one fetch fires (lock file test).
7. Worktree session: `wt:<name>` display works with new path.
