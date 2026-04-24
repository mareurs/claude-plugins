import os
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.hook_helpers import detect_plan_touch, _matches_plan_glob


PROJECT_ROOT = Path("/home/user/myproject")


def make_event(tool_name, **tool_input):
    return {"tool_name": tool_name, "tool_input": tool_input}


def test_native_edit_plan_path(tmp_path):
    event = make_event(
        "Edit",
        file_path="/home/user/myproject/docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_native_write_plan_path():
    event = make_event(
        "Write",
        file_path="/home/user/myproject/docs/superpowers/specs/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/specs/foo.md"


def test_native_read_plan_path():
    event = make_event(
        "Read",
        file_path="/home/user/myproject/docs/superpowers/plans/x.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/x.md"


def test_codescout_read_file_plan():
    event = make_event(
        "mcp__codescout__read_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_read_markdown_plan():
    event = make_event(
        "mcp__codescout__read_markdown",
        path="docs/superpowers/specs/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/specs/foo.md"


def test_codescout_edit_file_plan():
    event = make_event(
        "mcp__codescout__edit_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_create_file_plan():
    event = make_event(
        "mcp__codescout__create_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_insert_code_plan():
    event = make_event(
        "mcp__codescout__insert_code",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_replace_symbol_plan():
    event = make_event(
        "mcp__codescout__replace_symbol",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_path_outside_glob_returns_none():
    event = make_event(
        "Edit",
        file_path="/home/user/myproject/scripts/state.py",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_path_outside_project_returns_none():
    event = make_event("Edit", file_path="/etc/hosts")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_unknown_tool_returns_none():
    event = make_event("SomeUnknownTool", file_path="docs/superpowers/plans/foo.md")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_missing_tool_input_returns_none():
    event = {"tool_name": "Edit"}
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_empty_path_returns_none():
    event = make_event("Edit", file_path="")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_env_override_single_glob():
    with patch.dict(os.environ, {"BUDDY_PLAN_GLOBS": "custom/*.md"}):
        event = make_event("Edit", file_path="/home/user/myproject/custom/foo.md")
        assert detect_plan_touch(event, PROJECT_ROOT) == "custom/foo.md"


def test_env_override_multi_glob():
    with patch.dict(os.environ, {"BUDDY_PLAN_GLOBS": "a/*.md:b/*.md"}):
        event = make_event("Edit", file_path="/home/user/myproject/b/foo.md")
        assert detect_plan_touch(event, PROJECT_ROOT) == "b/foo.md"


def test_relative_native_path_passes_through():
    event = make_event("Edit", file_path="docs/superpowers/plans/foo.md")
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_matches_plan_glob_default():
    assert _matches_plan_glob("docs/superpowers/plans/foo.md")
    assert _matches_plan_glob("docs/superpowers/specs/foo.md")
    assert not _matches_plan_glob("scripts/state.py")
