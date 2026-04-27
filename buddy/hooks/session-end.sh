#!/usr/bin/env bash
# SessionEnd hook — graceful cleanup of own by-ppid entry.
set -e

EVENT=$(cat)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)

# Remove only our own PPID entry — leave others alone (SessionStart GC handles those)
ENTRY="$CWD/.buddy/by-ppid/$PPID"
[ -d "$ENTRY" ] && rm -rf "$ENTRY" 2>/dev/null || true

exit 0
