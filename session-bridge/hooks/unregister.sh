#!/usr/bin/env bash
# session-bridge/hooks/unregister.sh — Stop hook. Always exits 0.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

payload="$(cat)"
session_id="$(jq -r '.session_id // empty' <<< "$payload")"
[ -z "$session_id" ] && exit 0

sb_mutate_registry \
  'del(.sessions[$id])' \
  --arg id "$session_id"

exit 0
