"""Tests for state.py — state.json load/save with graceful fallback."""
import json
import os
import tempfile
from pathlib import Path

from scripts.state import load_state, save_state, default_state, STATE_VERSION


def test_load_state_returns_default_when_missing(tmp_path):
    path = tmp_path / "state.json"
    state = load_state(path)
    assert state == default_state()


def test_default_state_shape():
    s = default_state()
    assert s["version"] == STATE_VERSION
    assert "signals" in s
    assert s["derived_mood"] == "flow"
    assert s["suggested_specialist"] is None


def test_load_state_returns_default_when_corrupt(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{not valid json")
    state = load_state(path)
    assert state == default_state()


def test_save_state_round_trip(tmp_path):
    path = tmp_path / "state.json"
    s = default_state()
    s["derived_mood"] = "stuck"
    s["signals"]["context_pct"] = 42
    save_state(path, s)

    reloaded = load_state(path)
    assert reloaded["derived_mood"] == "stuck"
    assert reloaded["signals"]["context_pct"] == 42


def test_save_state_creates_parent_dir(tmp_path):
    path = tmp_path / "nested" / "deeper" / "state.json"
    save_state(path, default_state())
    assert path.exists()


def test_save_state_atomic_no_partial(tmp_path):
    """Save writes to a temp file then renames — a reader should never see
    a half-written file."""
    path = tmp_path / "state.json"
    save_state(path, default_state())
    with open(path) as f:
        data = json.load(f)
    assert data["version"] == STATE_VERSION


def test_default_state_has_active_specialists_empty_list():
    s = default_state()
    assert s["active_specialists"] == []



def test_default_state_includes_root_cwd():
    from scripts.state import default_state
    state = default_state()
    assert "root_cwd" in state["signals"]
    assert state["signals"]["root_cwd"] is None


def test_session_state_path_composes_correctly(tmp_path):
    from scripts.state import session_state_path
    result = session_state_path(tmp_path, "abc-123")
    assert result == tmp_path / ".buddy" / "abc-123" / "state.json"


def test_pid_started_at_returns_string_for_self():
    """The current process should be alive — ps must return a non-empty start time."""
    import os
    from scripts.state import pid_started_at
    result = pid_started_at(os.getpid())
    assert result is not None
    assert len(result) > 0


def test_pid_started_at_returns_none_for_nonexistent_pid():
    from scripts.state import pid_started_at
    # PID 0 is the kernel/scheduler placeholder — `ps -p 0` fails on Linux+macOS.
    result = pid_started_at(0)
    assert result is None


def test_pid_started_at_stable_across_calls():
    """Two consecutive calls for the same live pid must return the same value."""
    import os
    from scripts.state import pid_started_at
    a = pid_started_at(os.getpid())
    b = pid_started_at(os.getpid())
    assert a == b


def _setup_buddy_dir(tmp_path):
    d = tmp_path / ".buddy"
    d.mkdir()
    return d


def test_resolve_uses_by_ppid_when_started_at_matches(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    ppid_dir = bdir / "by-ppid" / "12345"
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sid-from-ppid")
    (ppid_dir / "started_at").write_text("Mon Jan 1 00:00:00 2026")
    monkeypatch.setattr(state_mod, "pid_started_at",
                        lambda pid: "Mon Jan 1 00:00:00 2026" if pid == 12345 else None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 12345)
    assert sid == "sid-from-ppid"


def test_resolve_falls_through_when_started_at_mismatches(tmp_path, monkeypatch):
    """PID reuse — stored start_time != current start_time. Reject the entry."""
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    ppid_dir = bdir / "by-ppid" / "12345"
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("stale-sid")
    (ppid_dir / "started_at").write_text("OLD")
    (bdir / ".current_session_id").write_text("pointer-sid")
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: "NEW")

    sid = state_mod.resolve_session_id_for_command(tmp_path, 12345)
    assert sid == "pointer-sid"


def test_resolve_uses_pointer_when_no_by_ppid(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / ".current_session_id").write_text("pointer-sid")
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "pointer-sid"


def test_resolve_uses_lone_session_dir_when_no_pointer(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "the-only-sid").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "the-only-sid"


def test_resolve_returns_none_when_multiple_dirs_no_pointer(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "sid-a").mkdir()
    (bdir / "sid-b").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid is None


def test_resolve_returns_none_when_buddy_dir_missing(tmp_path, monkeypatch):
    from scripts import state as state_mod
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)
    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid is None


def test_resolve_skips_by_ppid_dirs_in_lone_dir_check(tmp_path, monkeypatch):
    """`by-ppid/` is a system dir — must not be picked as a 'lone session dir'."""
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "by-ppid").mkdir()
    (bdir / "real-sid").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "real-sid"
