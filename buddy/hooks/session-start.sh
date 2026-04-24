#!/usr/bin/env bash
# SessionStart hook — resets session-scoped state fields + clears judge files.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$PLUGIN_ROOT/hooks/judge.env" ] && . "$PLUGIN_ROOT/hooks/judge.env"
# Dev-mode symlink health check
if [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -d "$CLAUDE_PLUGIN_ROOT" ] && [ ! -L "$CLAUDE_PLUGIN_ROOT" ]; then
    echo "⚠ buddy: dev symlink broken — run: bash $PLUGIN_ROOT/scripts/dev-install.sh" >&2
fi
python3 -c "
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
buddy_dir = Path.home() / '.claude' / 'buddy'
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
session_dir = project_root / '.buddy' / session_id
handle_session_start(
    event,
    path=buddy_dir / 'state.json',
    narrative_path=session_dir / 'narrative.jsonl',
    verdicts_path=session_dir / 'verdicts.json',
)
" || true
