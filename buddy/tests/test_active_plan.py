import json
from pathlib import Path

from scripts.state import load_active_plan, save_active_plan


def test_load_missing_returns_none(tmp_path):
    assert load_active_plan(tmp_path) is None


def test_save_then_load_roundtrip(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=1000)
    result = load_active_plan(tmp_path)
    assert result is not None
    assert result["path"] == "docs/plans/foo.md"
    assert result["source"] == "auto"
    assert result["set_at"] == 1000
    assert result["touched_ts"] == 1000


def test_save_updates_touched_ts_on_re_save(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=1000)
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=2000)
    result = load_active_plan(tmp_path)
    assert result["set_at"] == 1000  # preserved
    assert result["touched_ts"] == 2000  # updated


def test_explicit_blocks_auto_overwrite(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "explicit", now=1000)
    save_active_plan(tmp_path, "docs/plans/bar.md", "auto", now=2000)
    result = load_active_plan(tmp_path)
    assert result["path"] == "docs/plans/foo.md"
    assert result["source"] == "explicit"


def test_explicit_can_overwrite_explicit(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "explicit", now=1000)
    save_active_plan(tmp_path, "docs/plans/bar.md", "explicit", now=2000)
    result = load_active_plan(tmp_path)
    assert result["path"] == "docs/plans/bar.md"
    assert result["set_at"] == 2000


def test_corrupted_file_unlinks_and_returns_none(tmp_path):
    plan_path = tmp_path / "active_plan.json"
    plan_path.write_text("{not valid json")
    assert load_active_plan(tmp_path) is None
    assert not plan_path.exists()  # unlinked


def test_multi_instance_isolation(tmp_path):
    """Two sessions in the same project don't interfere."""
    session_a = tmp_path / "session-a"
    session_b = tmp_path / "session-b"
    session_a.mkdir()
    session_b.mkdir()

    save_active_plan(session_a, "docs/plans/foo.md", "auto", now=1000)
    save_active_plan(session_b, "docs/plans/bar.md", "auto", now=1000)

    assert load_active_plan(session_a)["path"] == "docs/plans/foo.md"
    assert load_active_plan(session_b)["path"] == "docs/plans/bar.md"
