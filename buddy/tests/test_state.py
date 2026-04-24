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
