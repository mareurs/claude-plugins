"""Tests for narrative accumulation in PostToolUse hook."""
import json
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
from scripts.hook_helpers import accumulate_narrative
from scripts.narrative import read_narrative


def test_accumulate_appends_action(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": "/home/user/project/scripts/buddha.py"},
        "timestamp": int(time.time()),
    }
    accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
    entries = read_narrative(narrative_path)
    assert len(entries) == 1
    assert "Edit" in entries[0]["text"]
    assert "buddha.py" in entries[0]["text"]


def test_accumulate_multiple_calls(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    for i in range(5):
        event = {"tool_name": "Read", "tool_input": {"file_path": f"/f{i}.py"}, "timestamp": int(time.time())}
        accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
    entries = read_narrative(narrative_path)
    assert len(entries) == 5


def test_accumulate_spawns_judge_at_interval(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    from scripts.narrative import append_entry
    for i in range(4):
        append_entry(narrative_path, "action", f"Action {i}")

    event = {"tool_name": "Edit", "tool_input": {"file_path": "/x.py"}, "timestamp": int(time.time())}

    with patch("scripts.hook_helpers.subprocess") as mock_sub:
        with patch.dict("os.environ", {"BUDDY_JUDGE_ENABLED": "true", "BUDDY_JUDGE_INTERVAL": "5"}):
            accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
        mock_sub.Popen.assert_called_once()


def test_accumulate_no_spawn_when_disabled(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    from scripts.narrative import append_entry
    for i in range(4):
        append_entry(narrative_path, "action", f"Action {i}")

    event = {"tool_name": "Edit", "tool_input": {"file_path": "/x.py"}, "timestamp": int(time.time())}

    with patch("scripts.hook_helpers.subprocess") as mock_sub:
        with patch.dict("os.environ", {"BUDDY_JUDGE_ENABLED": "false"}):
            accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
        mock_sub.Popen.assert_not_called()


def test_accumulate_silent_on_failure():
    """Must not raise even with bad inputs."""
    accumulate_narrative({}, Path("/dev/null/impossible"), project_root=Path("/tmp"), session_id="x")
    # No exception = pass


def test_accumulate_writes_active_plan_on_plan_touch(tmp_path):
    """When a plan file is touched, accumulate_narrative writes active_plan.json."""
    from scripts.hook_helpers import accumulate_narrative
    from scripts.state import load_active_plan

    narrative_path = tmp_path / "narrative.jsonl"
    project_root = tmp_path
    (project_root / "docs" / "superpowers" / "plans").mkdir(parents=True)

    event = {
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(project_root / "docs" / "superpowers" / "plans" / "foo.md"),
        },
        "session_id": "sess-123",
    }

    accumulate_narrative(
        event=event,
        narrative_path=narrative_path,
        project_root=project_root,
        session_id="sess-123",
    )

    plan = load_active_plan(narrative_path.parent)
    assert plan is not None
    assert plan["path"] == "docs/superpowers/plans/foo.md"
    assert plan["source"] == "auto"


def test_accumulate_no_active_plan_for_non_plan_files(tmp_path):
    from scripts.hook_helpers import accumulate_narrative
    from scripts.state import load_active_plan

    narrative_path = tmp_path / "narrative.jsonl"
    project_root = tmp_path

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(project_root / "scripts" / "state.py")},
        "session_id": "sess-123",
    }

    accumulate_narrative(
        event=event,
        narrative_path=narrative_path,
        project_root=project_root,
        session_id="sess-123",
    )

    assert load_active_plan(narrative_path.parent) is None
