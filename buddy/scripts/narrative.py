"""Append-only narrative log for the judge system.

Entries are JSONL lines with {ts, type, text}. The file grows until
compaction (handled by the judge worker, not here).
"""
import json
import os
import tempfile
import time
from pathlib import Path


def append_entry(path: Path, entry_type: str, text: str) -> None:
    """Append a single narrative entry. Silent on failure."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"ts": int(time.time()), "type": entry_type, "text": text}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def read_narrative(path: Path) -> list[dict]:
    """Read all narrative entries. Returns [] on any failure."""
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


MAX_ENTRIES_BEFORE_COMPACT = 50
KEEP_RECENT = 10


def compact_narrative(path: Path, summary: str) -> None:
    """Replace old entries with a single compact summary, keeping recent ones.

    Only compacts if entry count exceeds MAX_ENTRIES_BEFORE_COMPACT.
    Uses atomic write (mkstemp + os.replace) to avoid corruption.
    """
    try:
        entries = read_narrative(path)
        if len(entries) <= MAX_ENTRIES_BEFORE_COMPACT:
            return

        recent = entries[-KEEP_RECENT:]
        compact_entry = {"ts": int(time.time()), "type": "compact", "text": summary}

        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".narrative-", suffix=".jsonl.tmp", dir=path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(compact_entry, ensure_ascii=False) + "\n")
                for entry in recent:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        pass
