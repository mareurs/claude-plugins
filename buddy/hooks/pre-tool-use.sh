#!/usr/bin/env bash
# PreToolUse hook — reads cached verdicts. Only exit 2 when BUDDY_JUDGE_BLOCK=true.
# Default is warnings-only: verdicts stay in the JSON file for the statusline bubble.
# Warnings are never injected here; PostToolUse heuristics handle per-call hints.
# Must stay under 10ms. Never calls an LLM.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Source judge.env only as defaults — preserve any vars already set by the caller
# (tests pass BUDDY_* via env; judge.env must not override them)
if [ -f "$PLUGIN_ROOT/hooks/judge.env" ]; then
    _PRE_JUDGE_ENABLED="${BUDDY_JUDGE_ENABLED-__unset__}"
    _PRE_CS_JUDGE_ENABLED="${BUDDY_CS_JUDGE_ENABLED-__unset__}"
    _PRE_JUDGE_BLOCK="${BUDDY_JUDGE_BLOCK-__unset__}"
    . "$PLUGIN_ROOT/hooks/judge.env"
    [ "$_PRE_JUDGE_ENABLED" != "__unset__" ] && BUDDY_JUDGE_ENABLED="$_PRE_JUDGE_ENABLED"
    [ "$_PRE_CS_JUDGE_ENABLED" != "__unset__" ] && BUDDY_CS_JUDGE_ENABLED="$_PRE_CS_JUDGE_ENABLED"
    [ "$_PRE_JUDGE_BLOCK" != "__unset__" ] && BUDDY_JUDGE_BLOCK="$_PRE_JUDGE_BLOCK"
fi

# Only run if at least one judge is enabled
if [ "${BUDDY_JUDGE_ENABLED}" != "true" ] && [ "${BUDDY_CS_JUDGE_ENABLED}" != "true" ]; then
    exit 0
fi

# Python via heredoc with single-quoted delimiter — NO shell expansion inside.
# This avoids the quoting nightmare of `python3 -c "..."` where every Python
# string quote has to be backslash-escaped and every $ has to be protected.
export PLUGIN_ROOT
# Capture stdin before heredoc steals it — heredoc replaces Python's stdin.
EVENT_JSON=$(cat)
export EVENT_JSON
_py_exit=0
python3 <<'PYEOF' || _py_exit=$?
import sys, json, os
plugin_root = os.environ.get('PLUGIN_ROOT', '')
sys.path.insert(0, plugin_root)
from pathlib import Path
from scripts.pre_tool_gate import should_block, build_correction_message

event = {}
try:
    event = json.loads(os.environ.get('EVENT_JSON', '{}') or '{}')
except Exception:
    pass
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')

all_blocking = []

# Plan judge verdicts — blocking (stop Claude, fix the plan drift first)
if os.environ.get('BUDDY_JUDGE_ENABLED') == 'true':
    verdicts_path = project_root / '.buddy' / session_id / 'verdicts.json'
    blocked, verdicts = should_block(verdicts_path)
    if blocked:
        all_blocking.extend(verdicts)

# Codescout judge verdicts — only blocking severity interrupts. Warnings stay
# in cs_verdicts.json for the statusline bubble; PostToolUse heuristics
# already surface per-call soft hints.
if os.environ.get('BUDDY_CS_JUDGE_ENABLED') == 'true':
    cs_verdicts_path = project_root / '.buddy' / session_id / 'cs_verdicts.json'
    cs_blocked, cs_verdicts = should_block(cs_verdicts_path, min_severity="blocking")
    if cs_blocked:
        all_blocking.extend(cs_verdicts)

if all_blocking and os.environ.get('BUDDY_JUDGE_BLOCK') == 'true':
    msg = build_correction_message(all_blocking)
    print(msg, file=sys.stderr)
    sys.exit(2)
PYEOF
[ "$_py_exit" -eq 2 ] && exit 2 || true
