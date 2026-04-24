"""Tests for scripts/cs_judge_worker.py — async codescout judge."""
import json
from pathlib import Path
from unittest.mock import patch

from scripts.cs_tool_log import append_entry
from scripts.cs_judge_worker import run_cs_judge


def test_run_cs_judge_writes_verdict(tmp_path):
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__edit_file", "path=main.rs", "ok")

    mock_response = json.dumps({
        "verdict": "cs-misuse",
        "severity": "blocking",
        "evidence": "Used edit_file for structural change",
        "correction": "Use replace_symbol instead",
        "affected_tools": ["edit_file"],
    })

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response):
        run_cs_judge(
            cs_log_path=log_path,
            cs_verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "cs-misuse"
    assert data["active_verdicts"][0]["severity"] == "blocking"


def test_run_cs_judge_skips_on_ok(tmp_path):
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__list_symbols", "path=src/", "ok")

    mock_response = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_tools": [],
    })

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response):
        run_cs_judge(
            cs_log_path=log_path,
            cs_verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0


def test_run_cs_judge_deduplicates_same_verdict(tmp_path):
    """Second identical (verdict, affected_tools) should not be appended."""
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__read_file", "path=src/main.rs", "ok")

    mock_response = json.dumps({
        "verdict": "cs-misuse",
        "severity": "blocking",
        "evidence": "read_file on source",
        "correction": "use find_symbol",
        "affected_tools": ["read_file"],
    })

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response):
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1


def test_run_cs_judge_allows_different_verdict_type(tmp_path):
    """Different verdict type on same tools should still be written."""
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__read_file", "path=src/main.rs", "ok")

    first = json.dumps({
        "verdict": "cs-misuse",
        "severity": "blocking",
        "evidence": "read_file on source",
        "correction": "use find_symbol",
        "affected_tools": ["read_file"],
    })
    second = json.dumps({
        "verdict": "cs-inefficient",
        "severity": "blocking",
        "evidence": "different issue",
        "correction": "different fix",
        "affected_tools": ["read_file"],
    })

    with patch("scripts.cs_judge.call_cs_judge_llm", side_effect=[first, second]):
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 2


def test_run_cs_judge_allows_after_acknowledged(tmp_path):
    """Acknowledged verdict should not block a fresh one with same key."""
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__read_file", "path=src/main.rs", "ok")

    mock_response = json.dumps({
        "verdict": "cs-misuse",
        "severity": "blocking",
        "evidence": "read_file on source",
        "correction": "use find_symbol",
        "affected_tools": ["read_file"],
    })

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response):
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")

    # Acknowledge the verdict
    from scripts.verdicts import mark_acknowledged, read_verdicts
    data = read_verdicts(verdicts_path)
    ts = data["active_verdicts"][0]["ts"]
    mark_acknowledged(verdicts_path, ts)

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response):
        run_cs_judge(log_path, verdicts_path, tmp_path, "sess")

    data = read_verdicts(verdicts_path)
    unacked = [v for v in data["active_verdicts"] if not v.get("acknowledged")]
    assert len(unacked) == 1


def test_run_cs_judge_silent_on_llm_failure(tmp_path):
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    append_entry(log_path, "mcp__codescout__find_symbol", "query=foo", "ok")

    with patch("scripts.cs_judge.call_cs_judge_llm", side_effect=RuntimeError("API down")):
        run_cs_judge(
            cs_log_path=log_path,
            cs_verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0


def test_run_cs_judge_empty_log(tmp_path):
    """Should return early on empty log without error."""
    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"

    with patch("scripts.cs_judge.call_cs_judge_llm") as mock_llm:
        run_cs_judge(
            cs_log_path=log_path,
            cs_verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )
        mock_llm.assert_not_called()


def test_run_cs_judge_limits_to_window(tmp_path):
    """Should only send last JUDGE_WINDOW entries to LLM."""
    from scripts.cs_judge_worker import JUDGE_WINDOW

    log_path = tmp_path / "cs_tool_log.jsonl"
    verdicts_path = tmp_path / "cs_verdicts.json"
    for i in range(JUDGE_WINDOW + 10):
        append_entry(log_path, f"tool_{i}", f"args={i}", "ok")

    mock_response = json.dumps({"verdict": "ok"})

    with patch("scripts.cs_judge.call_cs_judge_llm", return_value=mock_response) as mock_llm:
        run_cs_judge(
            cs_log_path=log_path,
            cs_verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )
        # The prompt should reference JUDGE_WINDOW entries, not all
        call_args = mock_llm.call_args[0][0]
        assert f"last {JUDGE_WINDOW}" in call_args
