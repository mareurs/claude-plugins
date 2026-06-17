#!/usr/bin/env bash
# UserPromptSubmit hook — increments prompt count + maintains PPID index.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
command -v cygpath >/dev/null 2>&1 && PLUGIN_ROOT="$(cygpath -m "$PLUGIN_ROOT")"

EVENT=$(cat)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)
[ -z "$SID" ] && SID="unknown"

# Windows native Python is `python`, not `python3` — resolve once (no-op elsewhere).
PYTHON="$(command -v python3 || command -v python || echo python3)"

BUDDY_PROJECT_DIR="$CWD/.buddy"
BY_PPID_DIR="$BUDDY_PROJECT_DIR/by-ppid"
mkdir -p "$BY_PPID_DIR/$PPID" 2>/dev/null || true

echo "$SID" > "$BUDDY_PROJECT_DIR/.current_session_id" 2>/dev/null || true
echo "$SID" > "$BY_PPID_DIR/$PPID/session_id" 2>/dev/null || true
ps -o lstart= -p "$PPID" 2>/dev/null | sed 's/^ *//' > "$BY_PPID_DIR/$PPID/started_at" 2>/dev/null || true

echo "$EVENT" | "$PYTHON" -c "
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

# Skill ledger: scan new transcript bytes for Skill-tool loads (the only
# ground truth — no hook fires for Skill invocations, claude-code#43630).
# Stdout = context: emits repeat-load advisories only; silent otherwise.
echo "$EVENT" | "$PYTHON" -c "
import sys, json
sys.path.insert(0, '$PLUGIN_ROOT')
from scripts.skill_ledger import scan_from_event
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    event = {}
for line in scan_from_event(event):
    print(line)
" 2>/dev/null || true

# Summon bootstrap: /buddy:summon prompts get the full specialist payload
# injected here (zero model tool calls). Silent no-op for everything else;
# summon.md's legacy load path remains the fallback when this declines.
PROMPT=$(echo "$EVENT" | jq -r '.prompt // empty' 2>/dev/null || true)
case "$PROMPT" in
  /buddy:summon*)
    echo "$EVENT" | "$PYTHON" "$PLUGIN_ROOT/scripts/summon_bootstrap.py" 2>/dev/null || true
    ;;
esac
