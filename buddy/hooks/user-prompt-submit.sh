#!/usr/bin/env bash
# UserPromptSubmit hook — increments prompt count + maintains PPID index.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"

EVENT=$(cat)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)
[ -z "$SID" ] && SID="unknown"

BUDDY_PROJECT_DIR="$CWD/.buddy"
BY_PPID_DIR="$BUDDY_PROJECT_DIR/by-ppid"
mkdir -p "$BY_PPID_DIR/$PPID" 2>/dev/null || true

echo "$SID" > "$BUDDY_PROJECT_DIR/.current_session_id" 2>/dev/null || true
echo "$SID" > "$BY_PPID_DIR/$PPID/session_id" 2>/dev/null || true
ps -o lstart= -p "$PPID" 2>/dev/null | sed 's/^ *//' > "$BY_PPID_DIR/$PPID/started_at" 2>/dev/null || true

echo "$EVENT" | python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_user_prompt_submit
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
state_path = project_root / '.buddy' / session_id / 'state.json'
handle_user_prompt_submit(event, path=state_path)
" || true
