"""Tests for the PreToolUse gate — verdict reading and blocking decision."""
import json
import time
from pathlib import Path
from scripts.pre_tool_gate import should_block, build_correction_message


def _verdicts_file(tmp_path, verdicts):
    path = tmp_path / "verdicts.json"
    data = {
        "session_id": "test",
        "last_updated": int(time.time()),
        "active_verdicts": verdicts,
    }
    path.write_text(json.dumps(data))
    return path


def test_should_block_on_blocking_verdict(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Fix it",
        "affected_files": ["a.py"],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is True
    assert len(verdicts) == 1


def test_should_not_block_on_warning(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "doc-drift",
        "severity": "warning",
        "evidence": "Style issue",
        "correction": "Consider fixing",
        "affected_files": [],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_on_acknowledged(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Fix it",
        "affected_files": [],
        "acknowledged": True,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_on_stale(tmp_path):
    old_ts = int(time.time()) - 2000  # older than 30 min
    path = _verdicts_file(tmp_path, [{
        "ts": old_ts,
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Old issue",
        "correction": "Was relevant",
        "affected_files": [],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_missing_file(tmp_path):
    path = tmp_path / "nope.json"
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_build_correction_message():
    verdicts = [{
        "verdict": "missed-callers",
        "severity": "blocking",
        "evidence": "derive_mood() changed but render() not updated",
        "correction": "Update render() in statusline.py",
        "affected_files": ["scripts/buddha.py", "scripts/statusline.py"],
    }]
    msg = build_correction_message(verdicts)
    assert "MISSED-CALLERS" in msg
    assert "derive_mood()" in msg
    assert "Update render()" in msg


def test_build_correction_message_multiple():
    verdicts = [
        {"verdict": "plan-drift", "severity": "blocking",
         "evidence": "Wrong step", "correction": "Go back",
         "affected_files": []},
        {"verdict": "missed-callers", "severity": "blocking",
         "evidence": "Callers broken", "correction": "Fix callers",
         "affected_files": ["a.py"]},
    ]
    msg = build_correction_message(verdicts)
    assert "PLAN-DRIFT" in msg
    assert "MISSED-CALLERS" in msg
