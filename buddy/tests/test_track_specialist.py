"""Tests for track_specialist.py — CLI helper for summon/dismiss state updates."""
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "track_specialist.py"


def _run(args, *, cwd, env=None):
    e = os.environ.copy()
    e.pop("CLAUDE_PROJECT_DIR", None)
    if env:
        e.update(env)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(cwd), env=e, capture_output=True, text=True,
    )


def _seed_session(tmp_path, sid="sid-x"):
    buddy = tmp_path / ".buddy"
    buddy.mkdir(parents=True)
    (buddy / ".current_session_id").write_text(sid)
    return sid


def test_summon_appends_specialist(tmp_path):
    sid = _seed_session(tmp_path)
    r = _run(["summon", "debugging-yeti"], cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["debugging-yeti"]


def test_summon_is_idempotent(tmp_path):
    sid = _seed_session(tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["debugging-yeti"]


def test_summon_multiple_specialists(tmp_path):
    sid = _seed_session(tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    _run(["summon", "prompt-hamsa"], cwd=tmp_path)
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["debugging-yeti", "prompt-hamsa"]


def test_dismiss_specific_specialist(tmp_path):
    sid = _seed_session(tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    _run(["summon", "prompt-hamsa"], cwd=tmp_path)
    _run(["dismiss", "debugging-yeti"], cwd=tmp_path)
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["prompt-hamsa"]


def test_dismiss_all(tmp_path):
    sid = _seed_session(tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    _run(["summon", "prompt-hamsa"], cwd=tmp_path)
    _run(["dismiss"], cwd=tmp_path)
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == []


def test_dismiss_nonexistent_is_noop(tmp_path):
    sid = _seed_session(tmp_path)
    _run(["summon", "debugging-yeti"], cwd=tmp_path)
    r = _run(["dismiss", "prompt-hamsa"], cwd=tmp_path)
    assert r.returncode == 0
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["debugging-yeti"]


def test_uses_claude_project_dir_env(tmp_path):
    """CLAUDE_PROJECT_DIR overrides cwd — covers the case where Bash tool
    runs in a subdir of the project."""
    sid = _seed_session(tmp_path)
    subdir = tmp_path / "deep" / "nested"
    subdir.mkdir(parents=True)
    r = _run(["summon", "debugging-yeti"], cwd=subdir,
             env={"CLAUDE_PROJECT_DIR": str(tmp_path)})
    assert r.returncode == 0, r.stderr
    state = json.loads((tmp_path / ".buddy" / sid / "state.json").read_text())
    assert state["active_specialists"] == ["debugging-yeti"]


def test_no_session_exits_zero_with_message(tmp_path):
    """No .buddy dir — silent no-op so failures never break user flow."""
    r = _run(["summon", "debugging-yeti"], cwd=tmp_path)
    assert r.returncode == 0


def test_requires_action_arg(tmp_path):
    r = _run([], cwd=tmp_path)
    assert r.returncode != 0
