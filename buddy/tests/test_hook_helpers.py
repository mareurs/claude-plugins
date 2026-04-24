"""Tests for hook helper functions that mutate state.json."""
import json
from pathlib import Path

from scripts.hook_helpers import (
    handle_session_start,
    handle_post_tool_use,
    handle_user_prompt_submit,
)
from scripts.state import load_state, save_state, default_state


def test_session_start_resets_session_scoped_fields(tmp_path):
    path = tmp_path / "state.json"
    s = default_state()
    s["signals"]["prompt_count"] = 99
    s["signals"]["tool_call_count"] = 200
    s["signals"]["recent_errors"] = [{"ts": 1, "tool": "Bash", "error": "x"}]
    s["signals"]["last_edit_ts"] = 1000
    s["signals"]["last_commit_ts"] = 999
    save_state(path, s)

    handle_session_start({"timestamp": 5000}, path=path)
    result = load_state(path)

    assert result["signals"]["prompt_count"] == 0
    assert result["signals"]["tool_call_count"] == 0
    assert result["signals"]["recent_errors"] == []
    assert result["signals"]["session_start_ts"] == 5000
    assert result["signals"]["last_edit_ts"] == 1000
    assert result["signals"]["last_commit_ts"] == 999



def test_session_start_clears_root_cwd(tmp_path):
    """Session start clears root_cwd — it's set by the first activate_project('.') response."""
    from scripts.hook_helpers import handle_session_start
    from scripts.state import load_state, save_state, default_state

    state_path = tmp_path / "state.json"

    # Pre-seed a stale root_cwd from a previous session
    stale = default_state()
    stale["signals"]["root_cwd"] = "/stale/from/other/session"
    save_state(state_path, stale)

    event = {"timestamp": 100, "cwd": "/home/user/myproject"}
    handle_session_start(event, state_path)

    state = load_state(state_path)
    assert state["signals"]["root_cwd"] == "", \
        "session start should clear root_cwd, not set it from event['cwd']"


def test_post_tool_use_increments_counter(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    event = {"tool_name": "Read", "timestamp": 1000}
    handle_post_tool_use(event, path=path)
    result = load_state(path)

    assert result["signals"]["tool_call_count"] == 1


def test_post_tool_use_edit_updates_last_edit_ts(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    handle_post_tool_use({"tool_name": "Edit", "timestamp": 1234}, path=path)
    result = load_state(path)

    assert result["signals"]["last_edit_ts"] == 1234


def test_post_tool_use_bash_git_commit_updates_last_commit(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    event = {
        "tool_name": "Bash",
        "timestamp": 5000,
        "tool_input": {"command": "git commit -m 'feat: x'"},
    }
    handle_post_tool_use(event, path=path)
    result = load_state(path)

    assert result["signals"]["last_commit_ts"] == 5000


def test_post_tool_use_error_appends_recent_errors(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    event = {"tool_name": "Edit", "timestamp": 100, "tool_error": "bad path"}
    handle_post_tool_use(event, path=path)
    result = load_state(path)

    errors = result["signals"]["recent_errors"]
    assert len(errors) == 1
    assert errors[0]["tool"] == "Edit"


def test_post_tool_use_recent_errors_capped_at_10(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    for i in range(15):
        handle_post_tool_use(
            {"tool_name": "Edit", "timestamp": i, "tool_error": f"err{i}"},
            path=path,
        )
    result = load_state(path)
    assert len(result["signals"]["recent_errors"]) == 10
    assert result["signals"]["recent_errors"][0]["error"] == "err5"


def test_user_prompt_submit_increments_prompt_count(tmp_path):
    path = tmp_path / "state.json"
    save_state(path, default_state())

    handle_user_prompt_submit({"timestamp": 2000}, path=path)
    handle_user_prompt_submit({"timestamp": 2100}, path=path)
    result = load_state(path)

    assert result["signals"]["prompt_count"] == 2
    assert result["signals"]["idle_ts"] == 2100


from scripts.narrative import append_entry, read_narrative
from scripts.verdicts import write_verdict, read_verdicts


def test_session_start_clears_narrative_and_verdicts(tmp_path):
    state_path = tmp_path / "state.json"
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    # Pre-fill narrative and verdicts
    append_entry(narrative_path, "action", "old stuff")
    write_verdict(verdicts_path, {
        "ts": 1, "verdict": "plan-drift", "severity": "blocking",
        "evidence": "x", "correction": "y", "affected_files": [],
        "acknowledged": False,
    }, session_id="old-sess")

    event = {"timestamp": 1_000_000}
    from scripts.hook_helpers import handle_session_start
    handle_session_start(event, path=state_path,
                         narrative_path=narrative_path,
                         verdicts_path=verdicts_path)

    assert read_narrative(narrative_path) == []
    assert read_verdicts(verdicts_path)["active_verdicts"] == []



def test_cs_active_project_clears_on_absolute_home_path(tmp_path):
    """Restoring home via absolute path must clear cs_active_project."""
    from scripts.hook_helpers import handle_session_start, handle_cs_tool_use
    from scripts.state import load_state

    state_path = tmp_path / "state.json"
    session_dir = tmp_path / ".buddy" / "test-session"
    session_dir.mkdir(parents=True)

    # Session start stores root_cwd
    handle_session_start(
        {"timestamp": 100, "cwd": "/home/user/myproject"}, state_path,
    )

    # Activate a foreign project
    handle_cs_tool_use(
        event={
            "tool_name": "mcp__codescout__activate_project",
            "tool_input": {"path": "/tmp/foreign"},
            "cwd": "/home/user/myproject",
        },
        session_dir=session_dir,
        state_path=state_path,
        session_id="test-session",
    )
    state = load_state(state_path)
    assert state["signals"]["cs_active_project"] == "/tmp/foreign"

    # Restore home via absolute path (not ".")
    handle_cs_tool_use(
        event={
            "tool_name": "mcp__codescout__activate_project",
            "tool_input": {"path": "/home/user/myproject"},
            "cwd": "/home/user/myproject",
        },
        session_dir=session_dir,
        state_path=state_path,
        session_id="test-session",
    )
    state = load_state(state_path)
    assert state["signals"]["cs_active_project"] is None, \
        "absolute home path should clear cs_active_project"


def test_post_tool_use_cs_path_uses_event_cwd_not_root_cwd(tmp_path):
    """PostToolUse must derive cs session_dir from event['cwd'], not root_cwd.

    root_cwd is a shared global signal overwritten by every concurrent session.
    If PostToolUse used it for path derivation, Session B's activate_project
    would redirect Session A's verdicts into Session B's project tree.
    """
    from scripts.hook_helpers import handle_post_tool_use
    from scripts.state import load_state, save_state, default_state

    state_path = tmp_path / "state.json"
    state = default_state()

    project_a = tmp_path / "project_a"
    project_b = tmp_path / "project_b"
    project_a.mkdir()
    project_b.mkdir()

    # Simulate another session having stomped root_cwd with project_b
    state["signals"]["root_cwd"] = str(project_b)
    save_state(state_path, state)

    event = {
        "tool_name": "mcp__codescout__list_symbols",
        "tool_input": {"path": "src/"},
        "tool_output": "{}",
        "cwd": str(project_a),
        "session_id": "sess-a",
        "timestamp": 1000,
    }
    handle_post_tool_use(event, path=state_path)

    log_in_a = project_a / ".buddy" / "sess-a" / "cs_tool_log.jsonl"
    log_in_b = project_b / ".buddy" / "sess-a" / "cs_tool_log.jsonl"

    assert log_in_a.exists(), "cs_tool_log must land under event['cwd'], not root_cwd"
    assert not log_in_b.exists(), "verdicts must not leak into another session's project dir"


def test_session_start_subagent_does_not_reset_parent_signals(tmp_path):
    """SessionStart fired by a subagent must not reset the parent session's
    global signals.

    Detection heuristic: incoming session_id != stored current_session_id
    AND session_start_ts is recent (< 600s ago) → treat as subagent, skip reset.
    """
    from scripts.hook_helpers import handle_session_start
    from scripts.state import load_state, save_state, default_state

    state_path = tmp_path / "state.json"
    state = default_state()

    parent_ts = 1_000_000
    parent_sid = "parent-session-id"

    # Simulate active parent session
    state["current_session_id"] = parent_sid
    state["signals"]["session_start_ts"] = parent_ts
    state["signals"]["cs_tool_call_count"] = 50
    state["signals"]["recent_errors"] = [{"ts": 1, "tool": "Bash", "error": "x"}]
    save_state(state_path, state)

    # Subagent fires SessionStart 30 seconds later with a different session_id
    subagent_ts = parent_ts + 30
    handle_session_start(
        {"timestamp": subagent_ts, "session_id": "subagent-session-id", "source": "startup"},
        path=state_path,
    )

    result = load_state(state_path)
    # Parent session signals must NOT be reset
    assert result["signals"]["session_start_ts"] == parent_ts, \
        "subagent must not reset parent session_start_ts"
    assert result["signals"]["cs_tool_call_count"] == 50, \
        "subagent must not reset parent cs_tool_call_count"
    assert result["signals"]["recent_errors"] != [], \
        "subagent must not clear parent recent_errors"
    # current_session_id must remain the parent's
    assert result.get("current_session_id") == parent_sid


def test_session_start_new_top_level_session_still_resets(tmp_path):
    """A real new top-level session (session_id changed, long time gap) must
    still trigger a full signal reset.
    """
    from scripts.hook_helpers import handle_session_start
    from scripts.state import load_state, save_state, default_state

    state_path = tmp_path / "state.json"
    state = default_state()

    old_ts = 1_000_000
    state["current_session_id"] = "old-session-id"
    state["signals"]["session_start_ts"] = old_ts
    state["signals"]["cs_tool_call_count"] = 99
    save_state(state_path, state)

    # New session starts 2 hours later
    new_ts = old_ts + 7200
    handle_session_start(
        {"timestamp": new_ts, "session_id": "new-session-id", "source": "startup"},
        path=state_path,
    )

    result = load_state(state_path)
    assert result["signals"]["session_start_ts"] == new_ts, \
        "real new session must update session_start_ts"
    assert result["signals"]["cs_tool_call_count"] == 0, \
        "real new session must reset cs_tool_call_count"
    assert result.get("current_session_id") == "new-session-id"


def test_session_start_resume_within_600s_is_not_treated_as_subagent(tmp_path):
    """source='resume' must always trigger a full reset even within 600s.

    Without checking source, a quick --resume to a different session could be
    falsely identified as a subagent and skip the signal reset.
    """
    from scripts.hook_helpers import handle_session_start
    from scripts.state import load_state, save_state, default_state

    state_path = tmp_path / "state.json"
    state = default_state()

    parent_ts = 1_000_000
    state["current_session_id"] = "session-a"
    state["signals"]["session_start_ts"] = parent_ts
    state["signals"]["cs_tool_call_count"] = 42
    save_state(state_path, state)

    # User quickly resumes a different session (within 600s)
    resume_ts = parent_ts + 10
    handle_session_start(
        {"timestamp": resume_ts, "session_id": "session-b", "source": "resume"},
        path=state_path,
    )

    result = load_state(state_path)
    assert result["signals"]["cs_tool_call_count"] == 0, \
        "resume must reset signals regardless of time gap"
    assert result["signals"]["session_start_ts"] == resume_ts
    assert result.get("current_session_id") == "session-b"
