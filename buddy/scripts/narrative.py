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
    """Append a single narrative entry. Silent on failure.

    Enforces I-03 hard caps after every write so unbounded growth cannot occur
    even when the judge worker (which owns content-aware compaction) never
    spawns.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"ts": int(time.time()), "type": entry_type, "text": text}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        enforce_narrative_cap(path)
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



# I-03 hard caps — the safety net beneath compact_narrative.
# compact_narrative is content-aware (writes a real summary) but only runs when
# the judge worker spawns. With BUDDY_JUDGE_ENABLED unset, the file otherwise
# grows without bound. These caps engage even when the judge is disabled.
MAX_ENTRIES_HARD_CAP = 200
MAX_BYTES_HARD_CAP = 1_000_000  # 1 MB


def enforce_narrative_cap(path: Path) -> bool:
    """Truncate narrative to KEEP_RECENT entries when over hard caps.

    Returns True if truncation occurred. Drops oldest entries when:
      - file size exceeds MAX_BYTES_HARD_CAP, or
      - entry count exceeds MAX_ENTRIES_HARD_CAP.

    Inserts a 'truncated' placeholder so judge prompts know history was lost.
    Atomic via mkstemp + os.replace. Silent on failure (preserves the
    iron-rule contract that hooks never raise).

    Distinct from compact_narrative: that one writes a real summary supplied by
    the judge; this one is the unconditional safety net.
    """
    try:
        if not path.exists():
            return False
        size = path.stat().st_size
        # Cheap size-based check first; only read entries if needed.
        if size <= MAX_BYTES_HARD_CAP:
            entries = read_narrative(path)
            if len(entries) <= MAX_ENTRIES_HARD_CAP:
                return False
        else:
            entries = read_narrative(path)

        recent = entries[-KEEP_RECENT:] if entries else []
        dropped = len(entries) - len(recent)
        if dropped <= 0:
            return False

        placeholder = {
            "ts": int(time.time()),
            "type": "truncated",
            "text": (
                f"[narrative auto-truncated: {dropped} earlier entries dropped "
                f"(over hard cap of {MAX_ENTRIES_HARD_CAP} entries / "
                f"{MAX_BYTES_HARD_CAP} bytes)]"
            ),
        }

        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".narrative-", suffix=".jsonl.tmp", dir=path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(placeholder, ensure_ascii=False) + "\n")
                for entry in recent:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            os.replace(tmp_path, path)
            return True
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        return False
