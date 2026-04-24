#!/usr/bin/env bash
# PostToolUse hook — updates signals + accumulates narrative for judge.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$PLUGIN_ROOT/hooks/judge.env" ] && . "$PLUGIN_ROOT/hooks/judge.env"
python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_post_tool_use, accumulate_narrative
event = {}
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    pass
if 'timestamp' not in event:
    import time
    event['timestamp'] = int(time.time())
state_path = Path.home() / '.claude' / 'buddy' / 'state.json'
handle_post_tool_use(event, path=state_path)
from scripts.state import load_state as _load
_state = _load(state_path)
project_root = Path(_state['signals'].get('root_cwd') or event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
narrative_path = project_root / '.buddy' / session_id / 'narrative.jsonl'
accumulate_narrative(event, narrative_path, project_root=project_root, session_id=session_id)
" || true
