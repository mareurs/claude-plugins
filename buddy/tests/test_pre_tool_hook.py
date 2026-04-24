"""Integration tests for hooks/pre-tool-use.sh — exit code and routing."""
import json
import os
import subprocess
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.parent
HOOK = PLUGIN_ROOT / "hooks" / "pre-tool-use.sh"


def _make_verdicts(tmp_path, session_id, verdicts, kind="verdicts"):
    session_dir = tmp_path / ".buddy" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    path = session_dir / f"{kind}.json"
    path.write_text(json.dumps({
        "session_id": session_id,
        "last_updated": int(time.time()),
        "active_verdicts": verdicts,
    }))
    return path


def _run_hook(tmp_path, session_id="test-sess", cs_judge=False, judge=False, block=False):
    event = json.dumps({"cwd": str(tmp_path), "session_id": session_id})
    env = {
        **os.environ,
        "PLUGIN_ROOT": str(PLUGIN_ROOT),
        "BUDDY_CS_JUDGE_ENABLED": "true" if cs_judge else "false",
        "BUDDY_JUDGE_ENABLED": "true" if judge else "false",
        "BUDDY_JUDGE_BLOCK": "true" if block else "false",
    }
    return subprocess.run(
        ["bash", str(HOOK)],
        input=event,
        capture_output=True,
        text=True,
        env=env,
    )


def _cs_verdict(severity, acknowledged=False):
    return {
        "ts": int(time.time()),
        "verdict": "cs-misuse",
        "severity": severity,
        "evidence": "Used read_file on source",
        "correction": "Use list_symbols + find_symbol",
        "affected_tools": ["read_file"],
        "acknowledged": acknowledged,
    }


# ── Exit code propagation ────────────────────────────────────────────────────

def test_no_judges_enabled_exits_0(tmp_path):
    result = _run_hook(tmp_path)
    assert result.returncode == 0


def test_cs_blocking_verdict_does_not_block_by_default(tmp_path):
    # Default warnings-only mode: verdict is read but no exit 2.
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("blocking")], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True)
    assert result.returncode == 0


def test_cs_blocking_verdict_exits_2_when_block_true(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("blocking")], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True, block=True)
    assert result.returncode == 2


def test_cs_warning_verdict_exits_0(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("warning")], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True)
    assert result.returncode == 0


def test_cs_acknowledged_blocking_exits_0(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("blocking", acknowledged=True)], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True)
    assert result.returncode == 0


def test_plan_blocking_verdict_exits_2_when_block_true(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Off-task work",
        "correction": "Stay on task",
        "affected_files": [],
        "acknowledged": False,
    }], "verdicts")
    result = _run_hook(tmp_path, judge=True, block=True)
    assert result.returncode == 2


def test_plan_blocking_verdict_does_not_block_by_default(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Off-task work",
        "correction": "Stay on task",
        "affected_files": [],
        "acknowledged": False,
    }], "verdicts")
    result = _run_hook(tmp_path, judge=True)
    assert result.returncode == 0


def test_no_verdicts_file_exits_0(tmp_path):
    result = _run_hook(tmp_path, cs_judge=True)
    assert result.returncode == 0


# ── Output content ───────────────────────────────────────────────────────────

def test_blocking_stderr_contains_verdict_when_block_true(tmp_path):
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("blocking")], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True, block=True)
    assert "CS-MISUSE" in result.stderr
    assert "read_file" in result.stderr


def test_warning_produces_no_output(tmp_path):
    # Warnings only live in cs_verdicts.json for the statusline; PreToolUse
    # must stay silent on warnings to avoid spamming every tool call.
    _make_verdicts(tmp_path, "test-sess", [_cs_verdict("warning")], "cs_verdicts")
    result = _run_hook(tmp_path, cs_judge=True)
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
