"""State file helpers for the buddy plugin.

All failures are silent — missing or corrupt state is replaced with defaults.
The buddy must never break user flow.
"""
import json
import os
import tempfile
from pathlib import Path

STATE_VERSION = 1


def default_state() -> dict:
    return {
        "version": STATE_VERSION,
        "current_session_id": "",
        "signals": {
            "context_pct": 0,
            "last_edit_ts": 0,
            "last_commit_ts": 0,
            "session_start_ts": 0,
            "prompt_count": 0,
            "tool_call_count": 0,
            "last_test_result": None,
            "recent_errors": [],
            "idle_ts": 0,
            "judge_verdict": None,
            "judge_severity": None,
            "judge_block_count": 0,
            "judge_last_ts": 0,
            # Codescout judge signals (cleared each session)
            "cs_judge_verdict": None,
            "cs_judge_severity": None,
            "cs_tool_call_count": 0,
            "cs_active_project": None,
            "root_cwd": None,
        },
        "derived_mood": "flow",
        "suggested_specialist": None,
        "last_mood_transition_ts": 0,
        "active_specialists": [],
    }


def load_state(path: Path) -> dict:
    """Load state.json from `path`. Returns default_state() on any failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default_state()

    if not isinstance(data, dict) or data.get("version") != STATE_VERSION:
        return default_state()

    default = default_state()
    for key, value in default.items():
        if key not in data:
            data[key] = value
    for key, value in default["signals"].items():
        if key not in data.get("signals", {}):
            data["signals"][key] = value
    return data


def save_state(path: Path, state: dict) -> None:
    """Write state to `path` atomically (temp file + rename).

    Silent on failure — callers must not depend on state persisting.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".state-", suffix=".json.tmp", dir=path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        # Silent — never break the user's flow.
        pass


ACTIVE_PLAN_FILENAME = "active_plan.json"


def load_active_plan(session_dir: Path) -> dict | None:
    """Return the active_plan.json dict, or None if missing/invalid.

    On parse failure, silently unlinks the corrupted file so a fresh
    detection can overwrite it. Never raises.
    """
    plan_path = session_dir / ACTIVE_PLAN_FILENAME
    if not plan_path.exists():
        return None
    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        try:
            plan_path.unlink()
        except OSError:
            pass
        return None


def save_active_plan(
    session_dir: Path,
    path: str,
    source: str,
    now: int,
) -> None:
    """Write active_plan.json atomically.

    Explicit-over-auto precedence: if an existing entry has source='explicit',
    auto writes are refused. Caller MUST pass a project-relative path.
    """
    if source not in ("auto", "explicit"):
        return

    existing = load_active_plan(session_dir)
    set_at = now
    if existing:
        if existing.get("source") == "explicit" and source == "auto":
            return  # explicit sticks
        # Preserve original set_at when re-saving the same logical entry
        if existing.get("path") == path:
            set_at = existing.get("set_at", now)

    data = {
        "path": path,
        "source": source,
        "set_at": set_at,
        "touched_ts": now,
    }

    plan_path = session_dir / ACTIVE_PLAN_FILENAME
    try:
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".active-plan-", suffix=".json.tmp", dir=plan_path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, plan_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        pass
