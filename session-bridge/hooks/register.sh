#!/usr/bin/env bash
# session-bridge/hooks/register.sh — SessionStart hook.
# Stdin: JSON with session_id, cwd, transcript_path, hook_event_name.
# Always exits 0 (must never block CC startup).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

payload="$(cat)"
session_id="$(jq -r '.session_id // empty' <<< "$payload")"
cwd="$(jq -r '.cwd // empty' <<< "$payload")"
transcript_path="$(jq -r '.transcript_path // empty' <<< "$payload")"

if [ -z "$session_id" ]; then
  echo "session-bridge: no session_id in payload, skipping" >&2
  exit 0
fi

branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
instance="$(sb_instance "$transcript_path")"
pid="${PPID:-$$}"
started_at="$(date +%s)"

sb_mutate_registry \
  '.sessions[$id] = {
     session_id: $id,
     transcript_path: $tp,
     cwd: $cwd,
     branch: $branch,
     pid: $pid,
     started_at: $ts,
     alias: (.sessions[$id].alias // null),
     instance: $instance
   }' \
  --arg id "$session_id" \
  --arg cwd "$cwd" \
  --arg tp "$transcript_path" \
  --arg branch "$branch" \
  --arg instance "$instance" \
  --argjson pid "$pid" \
  --argjson ts "$started_at"

# Session-scoped state dir under the project cwd (mirrors buddy's .buddy/<sid> pattern).
# Slash commands read .current-session-id to know which session they're running inside.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  sb_dir="$cwd/.session-bridge"
  mkdir -p "$sb_dir/$session_id" 2>/dev/null || true
  printf '%s\n' "$session_id" > "$sb_dir/.current-session-id" 2>/dev/null || true
fi

exit 0
