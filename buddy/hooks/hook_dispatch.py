#!/usr/bin/env python3
"""Cross-platform dispatcher for the buddy hooks.

Invoked by hooks/run.mjs (the Node launcher that resolves a Python interpreter):

    <python> ${CLAUDE_PLUGIN_ROOT}/hooks/hook_dispatch.py <event-name>

Reads the hook event JSON on stdin, runs the matching scripts.hook_entry
function, and exits 0 (fail-open) — except pre-tool-use, which may exit 2 to
request an intentional judge block. PPID is taken from BUDDY_HOOK_PPID (the
launcher forwards Claude Code's PID, since this process's own parent is the
launcher), falling back to os.getppid().
"""
import json
import os
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))


def _ppid() -> int:
    raw = os.environ.get("BUDDY_HOOK_PPID")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return os.getppid()


def main() -> int:
    if len(sys.argv) < 2:
        return 0
    event_name = sys.argv[1]

    # judge.env supplies BUDDY_JUDGE_* config. Match the bash wrappers' precedence
    # per event: session-start / post-tool-use sourced it unconditionally (file
    # wins → override=True), pre-tool-use preserved any caller/test vars (caller
    # wins → override=False), and user-prompt-submit / session-end did not source
    # it at all.
    judge_env_override = {
        "session-start": True,
        "post-tool-use": True,
        "pre-tool-use": False,
    }
    if event_name in judge_env_override:
        try:
            from scripts.hook_helpers import load_judge_env
            load_judge_env(PLUGIN_ROOT, override=judge_env_override[event_name])
        except Exception:
            pass

    try:
        event = json.loads(sys.stdin.read() or "{}")
        if not isinstance(event, dict):
            event = {}
    except Exception:
        event = {}

    try:
        from scripts.hook_entry import DISPATCH
    except Exception:
        return 0
    fn = DISPATCH.get(event_name)
    if fn is None:
        return 0
    try:
        return fn(event, PLUGIN_ROOT, _ppid()) or 0
    except Exception:
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
