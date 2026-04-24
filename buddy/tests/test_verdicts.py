"""Tests for verdict I/O — atomic writes, expiry, acknowledgment."""
import json
import time
from pathlib import Path
from scripts.verdicts import (
    read_verdicts,
    write_verdict,
    mark_acknowledged,
    expire_stale,
    clear_verdicts,
    DEFAULT_VERDICT_TTL,
)


def _make_verdict(**overrides):
    base = {
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Plan says step 3 but Claude is on step 5",
        "correction": "Go back to step 3.",
        "affected_files": ["scripts/buddha.py"],
        "acknowledged": False,
    }
    base.update(overrides)
    return base


def test_write_and_read_verdict(tmp_path):
    path = tmp_path / "verdicts.json"
    v = _make_verdict()
    write_verdict(path, v, session_id="sess-1")
    data = read_verdicts(path)
    assert data["session_id"] == "sess-1"
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"


def test_write_verdict_appends(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(verdict="plan-drift"), session_id="sess-1")
    write_verdict(path, _make_verdict(verdict="missed-callers"), session_id="sess-1")
    data = read_verdicts(path)
    assert len(data["active_verdicts"]) == 2


def test_read_verdicts_missing_file(tmp_path):
    path = tmp_path / "does_not_exist.json"
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_read_verdicts_corrupt_file(tmp_path):
    path = tmp_path / "verdicts.json"
    path.write_text("{not valid json")
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_mark_acknowledged(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(ts=100), session_id="sess-1")
    write_verdict(path, _make_verdict(ts=200), session_id="sess-1")
    mark_acknowledged(path, ts=100)
    data = read_verdicts(path)
    assert data["active_verdicts"][0]["acknowledged"] is True
    assert data["active_verdicts"][1]["acknowledged"] is False


def test_expire_stale(tmp_path):
    path = tmp_path / "verdicts.json"
    old_ts = int(time.time()) - DEFAULT_VERDICT_TTL - 10
    write_verdict(path, _make_verdict(ts=old_ts), session_id="sess-1")
    write_verdict(path, _make_verdict(), session_id="sess-1")
    expire_stale(path)
    data = read_verdicts(path)
    assert len(data["active_verdicts"]) == 1


def test_clear_verdicts(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(), session_id="sess-1")
    clear_verdicts(path)
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_write_verdict_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "verdicts.json"
    write_verdict(path, _make_verdict(), session_id="sess-1")
    assert path.exists()
