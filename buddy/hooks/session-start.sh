#!/usr/bin/env bash
# SessionStart hook — resets session-scoped state + manages PPID index.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$PLUGIN_ROOT/hooks/judge.env" ] && . "$PLUGIN_ROOT/hooks/judge.env"

# Dev-mode symlink health check
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT" ] && [ ! -L "$CLAUDE_PLUGIN_ROOT" ]; then
    echo "⚠ buddy: dev symlink broken — run: bash $PLUGIN_ROOT/scripts/dev-install.sh" >&2
fi

# Read event from stdin
EVENT=$(cat)

# Extract cwd and session_id with jq (fall back to empty)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)
[ -z "$SID" ] && SID="unknown"

BUDDY_PROJECT_DIR="$CWD/.buddy"
BY_PPID_DIR="$BUDDY_PROJECT_DIR/by-ppid"

# Ensure dirs exist
mkdir -p "$BY_PPID_DIR/$PPID" 2>/dev/null || true

# Write pointer + by-ppid index
echo "$SID" > "$BUDDY_PROJECT_DIR/.current_session_id" 2>/dev/null || true
echo "$SID" > "$BY_PPID_DIR/$PPID/session_id" 2>/dev/null || true
ps -o lstart= -p "$PPID" 2>/dev/null | sed 's/^ *//' > "$BY_PPID_DIR/$PPID/started_at" 2>/dev/null || true

# GC: prune by-ppid entries whose started_at no longer matches
if [ -d "$BY_PPID_DIR" ]; then
  for entry in "$BY_PPID_DIR"/*; do
    [ -d "$entry" ] || continue
    pid=$(basename "$entry")
    [ "$pid" = "$PPID" ] && continue  # skip self (just-written)
    stored=""
    [ -f "$entry/started_at" ] && stored=$(cat "$entry/started_at" 2>/dev/null || echo "")
    current=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^ *//' || echo "")
    if [ -z "$current" ] || [ "$current" != "$stored" ]; then
      rm -rf "$entry" 2>/dev/null || true
    fi
  done
fi

# One-shot migration: remove dead global state.json
DEAD_GLOBAL="$HOME/.claude/buddy/state.json"
[ -f "$DEAD_GLOBAL" ] && rm -f "$DEAD_GLOBAL" 2>/dev/null || true

# Run state-handling Python with session-scoped path
echo "$EVENT" | python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_session_start
event = {}
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    pass
if 'timestamp' not in event:
    import time
    event['timestamp'] = int(time.time())
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
session_dir = project_root / '.buddy' / session_id
handle_session_start(
    event,
    path=session_dir / 'state.json',
    narrative_path=session_dir / 'narrative.jsonl',
    verdicts_path=session_dir / 'verdicts.json',
)
" || true
