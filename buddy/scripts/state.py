"""State file helpers for the buddy plugin.

All failures are silent — missing or corrupt state is replaced with defaults.
The buddy must never break user flow.
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

STATE_VERSION = 1

# Whether this platform can report a process's start time for PID-reuse
# detection. POSIX has `ps -o lstart=`; Windows has no `ps` and no stdlib
# start-time API (short of ctypes/psutil, which we decline — buddy stays
# dependency-free). Where unsupported, the by-ppid index keys on PPID alone.
_START_TIME_SUPPORTED = os.name != "nt"


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
        "parent_sid": "",
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


def session_state_path(project_root: Path, session_id: str) -> Path:
    """Per-session state.json path. Hooks/statusline write here; slash commands
    look it up via resolve_session_id_for_command()."""
    return project_root / ".buddy" / session_id / "state.json"


def pid_started_at(pid: int) -> str | None:
    """Return process start time as an opaque string, or None if unavailable.

    POSIX: uses `ps -o lstart= -p <pid>` (Linux + macOS). Returns None if the
    pid is gone or ps fails. Windows has no `ps` and no stdlib process-start
    API, so start-time reuse detection is unsupported there
    (``_START_TIME_SUPPORTED`` is False) — this returns None immediately and
    the resolver keys on PPID alone. Used to detect PID reuse: if a stored
    start_time differs from the current value for the same pid, the entry is
    stale.
    """
    if not _START_TIME_SUPPORTED:
        return None
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode != 0:
            return None
        out = result.stdout.strip()
        return out or None
    except (subprocess.SubprocessError, OSError, ValueError):
        return None


def resolve_session_id_for_command(project_root: Path, ppid: int) -> str | None:
    """Resolve the active session_id for a slash command running under PPID.

    Resolution chain:
      1. by-ppid/<ppid>/{session_id,started_at} — verify started_at matches current
         (on platforms without start-time support, trust the PPID mapping alone)
      2. .current_session_id pointer (last-writer)
      3. Sole session dir under .buddy/ (excluding by-ppid)
      4. None
    """
    buddy_dir = project_root / ".buddy"
    if not buddy_dir.is_dir():
        return None

    # 1. by-ppid index with PID-reuse verification
    ppid_dir = buddy_dir / "by-ppid" / str(ppid)
    sid_file = ppid_dir / "session_id"
    started_file = ppid_dir / "started_at"
    if sid_file.is_file():
        try:
            if not _START_TIME_SUPPORTED:
                # Platform can't verify process start time (e.g. Windows: no
                # stdlib start-time API) — trust the PPID mapping alone. NOTE:
                # this returns before the pointer / lone-dir steps below, and
                # session-start GC cannot detect PID reuse without a start-time
                # either, so a reused PID could resolve to a dead session. This
                # is an accepted, bounded Windows-only limitation; the by-ppid
                # *writer* is still bash-only (ported in P3), so this branch is
                # not yet reached on Windows. Revisit the Windows by-ppid
                # strategy when the writer lands.
                sid = sid_file.read_text().strip()
                if sid:
                    return sid
            elif started_file.is_file():
                stored_started = started_file.read_text().strip()
                current_started = pid_started_at(ppid)
                if current_started and current_started == stored_started:
                    sid = sid_file.read_text().strip()
                    if sid:
                        return sid
        except OSError:
            pass

    # 2. Last-writer pointer
    pointer = buddy_dir / ".current_session_id"
    if pointer.is_file():
        try:
            sid = pointer.read_text().strip()
            if sid:
                return sid
        except OSError:
            pass

    # 3. Lone session dir (skip by-ppid and dotfiles)
    try:
        candidates = [
            p for p in buddy_dir.iterdir()
            if p.is_dir() and p.name != "by-ppid" and not p.name.startswith(".")
        ]
        if len(candidates) == 1:
            return candidates[0].name
    except OSError:
        pass

    return None
def update_ppid_index(project_root, sid: str, ppid: int) -> None:
    """Write the last-writer pointer + by-ppid/<ppid> mapping for this session.

    Cross-platform replacement for the bash `echo … > … ; ps -o lstart= …`
    block in the session-start / user-prompt-submit wrappers. started_at is
    written only where process start-time is available (POSIX); on Windows it
    is omitted and the resolver keys on PPID alone (see pid_started_at). All
    writes are best-effort — buddy must never break the user's flow.
    """
    buddy_dir = Path(project_root) / ".buddy"
    ppid_dir = buddy_dir / "by-ppid" / str(ppid)
    try:
        ppid_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    for path, value in (
        (buddy_dir / ".current_session_id", sid),
        (ppid_dir / "session_id", sid),
    ):
        try:
            path.write_text(value)
        except OSError:
            pass
    started = pid_started_at(ppid)
    if started:
        try:
            (ppid_dir / "started_at").write_text(started)
        except OSError:
            pass


def gc_ppid_index(project_root, keep_ppid: int) -> None:
    """Prune stale by-ppid entries (dead pid, or PID reused → start-time drift).

    Only runs where start-time verification is supported; on platforms without
    it (Windows), reuse cannot be detected safely, so entries are left in place
    (session-end removes each session's own entry, and the resolver trusts the
    PPID mapping there — an accepted, bounded limitation).
    """
    if not _START_TIME_SUPPORTED:
        return
    by_ppid = Path(project_root) / ".buddy" / "by-ppid"
    if not by_ppid.is_dir():
        return
    try:
        entries = list(by_ppid.iterdir())
    except OSError:
        return
    for entry in entries:
        if not entry.is_dir():
            continue
        try:
            pid = int(entry.name)
        except ValueError:
            continue
        if pid == keep_ppid:
            continue
        stored = ""
        started_file = entry / "started_at"
        if started_file.is_file():
            try:
                stored = started_file.read_text().strip()
            except OSError:
                stored = ""
        current = pid_started_at(pid) or ""
        if not current or current != stored:
            shutil.rmtree(entry, ignore_errors=True)


def remove_ppid_entry(project_root, ppid: int) -> None:
    """Remove this session's own by-ppid entry (SessionEnd cleanup)."""
    entry = Path(project_root) / ".buddy" / "by-ppid" / str(ppid)
    if entry.is_dir():
        shutil.rmtree(entry, ignore_errors=True)
