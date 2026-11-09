#!/usr/bin/env python3
"""cs-hint for Codex: PostToolUse hook that prints the buddy [cs-hint] advisories.

Reads the hook event JSON on stdin and prints either nothing or one JSON object with
hookSpecificOutput.additionalContext, which Codex hands to the model. The heuristics
are the unchanged buddy modules in ../scripts (kept byte-identical by
tests/test-cs-hint-codex.sh). Every failure is silent: no output, exit 0.

State: a rolling per-session log of codescout calls, under $PLUGIN_DATA (Codex) or
$CLAUDE_PLUGIN_DATA, else ~/.cache/cs-hint-codex. Set CS_HINT_ENABLED=false to disable.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def _log_path(event: dict) -> Path:
    base = os.environ.get("PLUGIN_DATA") or os.environ.get("CLAUDE_PLUGIN_DATA")
    root = Path(base) if base else Path.home() / ".cache" / "cs-hint-codex"
    sid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(event.get("session_id") or "nosession"))
    return root / sid / "cs_tool_log.jsonl"


def _outcome(event: dict) -> str:
    response = event.get("tool_response") or {}
    if event.get("tool_error"):
        return "error"
    if isinstance(response, dict) and "output_id" in response:
        return "buffered"
    return "ok"


def main() -> int:
    try:
        if os.environ.get("CS_HINT_ENABLED", "true") != "true":
            return 0
        event = json.load(sys.stdin)
        tool = event.get("tool_name", "")
        from cs_heuristics import check
        from cs_tool_log import append_entry, summarize_args

        if tool == "Bash":
            session_log: list[dict] = []
        elif tool.startswith("mcp__codescout__"):
            session_log = append_entry(
                _log_path(event),
                tool=tool,
                args_summary=summarize_args(event.get("tool_input") or {}),
                outcome=_outcome(event),
            )
        else:
            return 0
        correction = check(event, session_log, root_cwd="")
        if correction:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": f"[cs-hint] {correction}",
                },
            }))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
