"""Verdict I/O for the judge system.

Verdicts are stored in a single JSON file with atomic writes.
The PreToolUse hook reads this file; the judge worker writes to it.
"""
import json
import os
import tempfile
import time
from pathlib import Path

DEFAULT_VERDICT_TTL = 1800  # 30 minutes


def read_verdicts(path: Path) -> dict:
    """Read verdicts file. Returns empty structure on any failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "active_verdicts" in data:
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"session_id": "", "last_updated": 0, "active_verdicts": []}


def write_verdict(path: Path, verdict: dict, session_id: str) -> None:
    """Append a verdict to the verdicts file. Atomic write."""
    try:
        existing = read_verdicts(path)
        existing["session_id"] = session_id
        existing["last_updated"] = int(time.time())
        existing["active_verdicts"].append(verdict)
        _atomic_write(path, existing)
    except Exception:
        pass


def mark_acknowledged(path: Path, ts: int) -> None:
    """Mark a verdict as acknowledged by its timestamp."""
    try:
        data = read_verdicts(path)
        for v in data["active_verdicts"]:
            if v.get("ts") == ts:
                v["acknowledged"] = True
        _atomic_write(path, data)
    except Exception:
        pass


def expire_stale(path: Path, ttl: int = DEFAULT_VERDICT_TTL) -> None:
    """Remove verdicts older than ttl seconds."""
    try:
        data = read_verdicts(path)
        cutoff = int(time.time()) - ttl
        data["active_verdicts"] = [
            v for v in data["active_verdicts"] if v.get("ts", 0) > cutoff
        ]
        _atomic_write(path, data)
    except Exception:
        pass


def clear_verdicts(path: Path) -> None:
    """Remove all verdicts."""
    try:
        _atomic_write(path, {
            "session_id": "",
            "last_updated": int(time.time()),
            "active_verdicts": [],
        })
    except Exception:
        pass


def _atomic_write(path: Path, data: dict) -> None:
    """Write JSON atomically via mkstemp + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=".verdicts-", suffix=".json.tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


BUBBLE_TTL_DEFAULT = 10
BUBBLE_TTL_MIN = 3
BUBBLE_TTL_MAX = 60


def _bubble_ttl() -> int:
    try:
        raw = int(os.environ.get("BUDDY_BUBBLE_TTL", BUBBLE_TTL_DEFAULT))
    except (ValueError, TypeError):
        return BUBBLE_TTL_DEFAULT
    return max(BUBBLE_TTL_MIN, min(BUBBLE_TTL_MAX, raw))


def fresh_verdict(
    session_dir: Path,
    now: int,
    ttl: int | None = None,
    verdicts_file: str = "verdicts.json",
) -> tuple[dict, int] | None:
    """Return (latest_fresh_verdict, total_fresh_count) or None.

    Single read of verdicts file. Returns None on missing file, parse failure,
    empty active_verdicts, or no verdicts within the TTL window.
    """
    if ttl is None:
        ttl = _bubble_ttl()
    verdicts_path = session_dir / verdicts_file
    if not verdicts_path.exists():
        return None
    try:
        with open(verdicts_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    active = data.get("active_verdicts", [])
    fresh = [v for v in active if (now - v.get("ts", 0)) <= ttl]
    if not fresh:
        return None
    return fresh[-1], len(fresh)
