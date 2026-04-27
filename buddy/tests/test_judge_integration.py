"""End-to-end integration test for the judge pipeline."""
import json
import time
from pathlib import Path
from unittest.mock import patch
from scripts.narrative import append_entry, read_narrative
from scripts.judge_worker import run_judge
from scripts.verdicts import read_verdicts
from scripts.pre_tool_gate import should_block, build_correction_message


def test_full_pipeline_blocking_verdict(tmp_path):
    """Full flow: narrative -> judge -> verdict -> gate blocks."""
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    # Simulate a session with drift
    append_entry(narrative_path, "goal", "User wants to fix login bug in auth.py")
    append_entry(narrative_path, "action", "Claude Edit scripts/buddha.py — changed mood waterfall")
    append_entry(narrative_path, "action", "Claude Edit scripts/statusline.py — refactored render")

    # Mock LLM returns a plan-drift verdict
    mock_response = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "User asked to fix login bug in auth.py but Claude is editing buddha.py and statusline.py",
        "correction": "Stop editing mood/statusline code. Focus on auth.py as the user requested.",
        "affected_files": ["scripts/buddha.py", "scripts/statusline.py"],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="integration-test",
            state_path=tmp_path / "state.json",
        )

    # Verify verdict was written
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"

    # Verify gate blocks
    blocked, verdicts = should_block(verdicts_path)
    assert blocked is True

    # Verify correction message is readable
    msg = build_correction_message(verdicts)
    assert "PLAN-DRIFT" in msg
    assert "auth.py" in msg


def test_full_pipeline_ok_verdict_no_block(tmp_path):
    """Full flow: narrative -> judge -> ok -> gate allows."""
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    append_entry(narrative_path, "goal", "User wants to add tests")
    append_entry(narrative_path, "action", "Claude Edit tests/test_foo.py — added test")

    mock_response = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="integration-test",
            state_path=tmp_path / "state.json",
        )

    blocked, verdicts = should_block(verdicts_path)
    assert blocked is False
