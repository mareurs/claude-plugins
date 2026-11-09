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

    `path` / `file_path` are emitted FIRST, and the record-level cut carries a
    marker. Both matter, and neither used to hold: the cut was a blind `[:200]`
    on the joined string, so whether the path survived was decided by where the
    caller's JSON happened to put it. Measured over 1,920 write records on this
    machine, 11.5% carried no `path=` at all and 147 named a path that does not
    exist on disk — well-formed prefixes like `src/serve`, unmarked, which a
    consumer will happily match. A path is now either verbatim or explicitly
    marked, never silently a prefix.
    See docs/issues/archive/2026-09-01-summarize-args-destroys-the-path-it-documents-preserving.md
    """
    if not isinstance(tool_input, dict):
        return str(tool_input)[:100]

    PATH_KEYS = ("path", "file_path")

    def render(key, val):
        if isinstance(val, str) and len(val) > 80:
            val = val[:77] + "..."
        return f"{key}={val}"

    # Path keys first: the record-level cut below trims the tail, so anything
    # placed first is structurally out of its reach.
    parts = [render(k, tool_input[k]) for k in PATH_KEYS if k in tool_input]
    parts += [render(k, v) for k, v in tool_input.items() if k not in PATH_KEYS]

    out = ", ".join(parts)
    if len(out) > 200:
        # Same self-marking contract the per-value cut above has, so a consumer
        # can tell "this record was cut" from "this value was short".
        out = out[:197] + "..."
    return out
