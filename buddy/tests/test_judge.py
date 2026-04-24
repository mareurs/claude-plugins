"""Tests for judge prompt building and response parsing."""
import json
from scripts.judge import build_judge_prompt, parse_judge_response, VALID_VERDICTS


def test_build_prompt_includes_narrative():
    narrative_entries = [
        {"ts": 1000, "type": "goal", "text": "User wants to fix login bug"},
        {"ts": 1001, "type": "action", "text": "Claude read auth.py"},
    ]
    prompt = build_judge_prompt(
        narrative_entries=narrative_entries,
        plan_content="Step 1: fix auth.py",
        project_constraints="Must use atomic writes",
        affected_symbols="auth.py: login(), validate_token()",
        test_state=None,
    )
    assert "fix login bug" in prompt
    assert "Claude read auth.py" in prompt
    assert "Step 1: fix auth.py" in prompt
    assert "atomic writes" in prompt
    assert "login(), validate_token()" in prompt


def test_build_prompt_handles_missing_plan():
    prompt = build_judge_prompt(
        narrative_entries=[{"ts": 1, "type": "action", "text": "did stuff"}],
        plan_content=None,
        project_constraints="",
        affected_symbols="",
        test_state=None,
    )
    assert "No active plan found" in prompt


def test_build_prompt_handles_compact_entry():
    entries = [
        {"ts": 1, "type": "compact", "text": "[SUMMARY] Did 50 things."},
        {"ts": 2, "type": "action", "text": "Claude edited state.py"},
    ]
    prompt = build_judge_prompt(
        narrative_entries=entries,
        plan_content=None,
        project_constraints="",
        affected_symbols="",
        test_state=None,
    )
    assert "[SUMMARY] Did 50 things." in prompt
    assert "Claude edited state.py" in prompt


def test_parse_response_valid_ok():
    raw = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "ok"
    assert result["severity"] == "info"


def test_parse_response_valid_blocking():
    raw = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Plan says step 3 but working on step 5",
        "correction": "Go back to step 3",
        "affected_files": ["scripts/buddha.py"],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "plan-drift"
    assert result["severity"] == "blocking"
    assert "step 3" in result["evidence"]


def test_parse_response_invalid_json():
    result = parse_judge_response("not json at all")
    assert result["verdict"] == "ok"
    assert result["severity"] == "info"


def test_parse_response_unknown_verdict_normalized():
    raw = json.dumps({
        "verdict": "something-weird",
        "severity": "blocking",
        "evidence": "x",
        "correction": "y",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "ok"


def test_parse_response_unknown_severity_normalized():
    raw = json.dumps({
        "verdict": "plan-drift",
        "severity": "catastrophic",
        "evidence": "x",
        "correction": "y",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["severity"] == "info"


def test_valid_verdicts_set():
    assert "ok" in VALID_VERDICTS
    assert "plan-drift" in VALID_VERDICTS
    assert "doc-drift" in VALID_VERDICTS
    assert "missed-callers" in VALID_VERDICTS
    assert "missed-consideration" in VALID_VERDICTS
    assert "scope-creep" in VALID_VERDICTS
