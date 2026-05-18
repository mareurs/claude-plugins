#!/usr/bin/env bash
# session-bridge/hooks/unregister.sh — Stop hook. Always exits 0.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

payload="$(cat)"
session_id="$(jq -r '.session_id // empty' <<< "$payload")"
cwd="$(jq -r '.cwd // empty' <<< "$payload")"
[ -z "$session_id" ] && exit 0

sb_mutate_registry \
  'del(.sessions[$id])' \
  --arg id "$session_id"

# Clean up session-scoped state. Only drop the per-session dir + .current-session-id
# (if it still points at us). Leave .session-bridge/ in place — it may hold state for
# other sessions started later from the same cwd.
if [ -n "$cwd" ] && [ -d "$cwd/.session-bridge" ]; then
  rm -rf "$cwd/.session-bridge/$session_id" 2>/dev/null || true
  marker="$cwd/.session-bridge/.current-session-id"
  if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$session_id" ]; then
    rm -f "$marker" 2>/dev/null || true
  fi
  # If dir is now empty, remove it.
  rmdir "$cwd/.session-bridge" 2>/dev/null || true
fi

exit 0
