#!/usr/bin/env bash
# UserPromptSubmit hook — increments prompt count, updates idle timer.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "
import sys, json
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
handle_user_prompt_submit(event, path=Path.home() / '.claude' / 'buddy' / 'state.json')
" || true
