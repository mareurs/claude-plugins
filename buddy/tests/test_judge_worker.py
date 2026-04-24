"""Tests for the judge worker — context assembly and end-to-end flow."""
import json
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
from scripts.judge_worker import assemble_context, run_judge, format_action_entry
from scripts.narrative import append_entry


def test_format_action_entry_edit():
    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": "/home/user/project/scripts/buddha.py"},
    }
    result = format_action_entry(event)
    assert "Edit" in result
    assert "buddha.py" in result


def test_format_action_entry_bash():
    event = {
        "tool_name": "Bash",
        "tool_input": {"command": "pytest tests/ -v"},
    }
    result = format_action_entry(event)
    assert "Bash" in result
    assert "pytest" in result


def test_format_action_entry_unknown_tool():
    event = {"tool_name": "SomeTool"}
    result = format_action_entry(event)
    assert "SomeTool" in result


def test_assemble_context_reads_narrative(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "goal", "Fix the bug")
    append_entry(narrative_path, "action", "Read auth.py")

    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert len(ctx["narrative_entries"]) == 2
    assert ctx["narrative_entries"][0]["text"] == "Fix the bug"


def test_assemble_context_loads_plan(tmp_path):
    """Updated: plan now loads via session-scoped active_plan, not glob."""
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "something")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "2026-04-14-feature.md").write_text("# Plan\nStep 1: do thing")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/2026-04-14-feature.md",
        "auto",
        now=1000,
    )

    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert "Step 1: do thing" in ctx["plan_content"]


def test_assemble_context_no_plan(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "something")
    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert ctx["plan_content"] is None


def test_assemble_context_reads_session_active_plan(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "the-active-plan.md").write_text("# Active\nStep A: do A")
    (plans_dir / "z-newer-by-name.md").write_text("# Other\nStep Z: do Z")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/the-active-plan.md",
        "explicit",
        now=1000,
    )

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert "Step A: do A" in ctx["plan_content"]
    assert "Step Z" not in ctx["plan_content"]


def test_assemble_context_no_active_plan_returns_none(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "stale-plan.md").write_text("# Stale\nDo not pick me")

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert ctx["plan_content"] is None


def test_assemble_context_invalid_active_plan_path(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/does-not-exist.md",
        "auto",
        now=1000,
    )

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert ctx["plan_content"] is None


def test_run_judge_writes_verdict(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "Claude edited buddha.py")

    mock_response = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Go back",
        "affected_files": ["buddha.py"],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"


def test_run_judge_skips_on_ok_verdict(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "Claude read a file")

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
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0


def test_run_judge_silent_on_llm_failure(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "something")

    with patch("scripts.judge.call_judge_llm", side_effect=RuntimeError("API down")):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0


def test_format_action_entry_codescout_read_file():
    from scripts.judge_worker import format_action_entry
    event = {
        "tool_name": "mcp__codescout__read_file",
        "tool_input": {"path": "scripts/state.py"},
    }
    result = format_action_entry(event)
    assert "cs.read_file" in result
    assert "state.py" in result


def test_format_action_entry_codescout_edit_file():
    from scripts.judge_worker import format_action_entry
    event = {
        "tool_name": "mcp__codescout__edit_file",
        "tool_input": {"path": "scripts/state.py"},
    }
    result = format_action_entry(event)
    assert "cs.edit_file" in result


def test_format_action_entry_codescout_no_path():
    from scripts.judge_worker import format_action_entry
    event = {"tool_name": "mcp__codescout__find_symbol", "tool_input": {"query": "x"}}
    result = format_action_entry(event)
    assert result == "Claude cs.find_sym"


def test_assemble_context_extracts_cs_edit_files(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude cs.edit_file scripts/state.py")
    append_entry(narrative_path, "action", "Claude cs.create_file tests/new.py")

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert "scripts/state.py" in ctx["affected_symbols"]
    assert "tests/new.py" in ctx["affected_symbols"]
