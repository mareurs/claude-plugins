"""Per-session log of codescout MCP tool calls.

Rolling JSONL file capped at MAX_ENTRIES. Written by handle_cs_tool_use,
read by cs_heuristics (recent look-back) and cs_judge_worker (LLM context).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

MAX_ENTRIES = 50


def append_entry(
    path: Path,
    tool: str,
    args_summary: str,
    outcome: str,
) -> list[dict]:
    """Append a tool call entry and return the current log (post-cap).

    Returns the full log so callers (heuristics) can inspect it without
    a second read.  Silent on failure — returns empty list.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": int(time.time()),
            "tool": tool,
            "args": args_summary,
            "outcome": outcome,
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        # Read back + enforce cap
        entries = read_entries(path)
        if len(entries) > MAX_ENTRIES:
            entries = entries[-MAX_ENTRIES:]
            _rewrite(path, entries)
        return entries
    except Exception:
        return []


def read_entries(path: Path) -> list[dict]:
    """Read all entries from the log. Returns empty list on any failure."""
    try:
        if not path.exists():
            return []
        entries = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries
    except Exception:
        return []


def _rewrite(path: Path, entries: list[dict]) -> None:
    """Rewrite the log file with the given entries (for cap enforcement)."""
    import os
    import tempfile

    try:
        fd, tmp = tempfile.mkstemp(
            prefix=".", suffix=".jsonl.tmp", dir=path.parent,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                for entry in entries:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception:
        pass


def summarize_args(tool_input: dict) -> str:
    """Produce a compact summary of tool arguments for the log.

    Keeps the log token-efficient: file paths preserved, large string
    values truncated.
    """
    if not isinstance(tool_input, dict):
        return str(tool_input)[:100]

    parts = []
    for key, val in tool_input.items():
        if isinstance(val, str) and len(val) > 80:
            val = val[:77] + "..."
        parts.append(f"{key}={val}")
    return ", ".join(parts)[:200]
