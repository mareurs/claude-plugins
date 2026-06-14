"""Apply-phase mechanics: archive helpers, plan execution, idempotency."""
import shutil
from pathlib import Path

import pytest

from scripts.consolidate import archive_entry, ARCHIVE_DIRNAME


@pytest.fixture
def channel(tmp_path):
    """Empty channel scaffold with one entry under prompt-hamsa/."""
    spec = tmp_path / "prompt-hamsa"
    spec.mkdir()
    (spec / "x.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: x\n"
        "created: 2026-04-01\nupdated: 2026-04-01\ntags: [t]\n---\n\n**Lesson:** hi.\n"
    )
    return tmp_path


def test_archive_moves_entry_to_dated_subdir(channel):
    new_path = archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    assert new_path.exists()
    assert new_path.parent.name == "2026-05-07"
    assert new_path.parent.parent.name == ARCHIVE_DIRNAME
    assert not (channel / "prompt-hamsa" / "x.md").exists()


def test_archive_same_day_collision_suffixes(channel):
    archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    # Second entry with same name (different content), archived same day:
    (channel / "prompt-hamsa" / "x.md").write_text("v2")
    new_path = archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    assert new_path.parent.name == "2026-05-07-2"


def test_archive_missing_raises(channel):
    with pytest.raises(FileNotFoundError):
        archive_entry(channel, "prompt-hamsa", "does-not-exist", today="2026-05-07")


def test_regen_index_skips_archive_directory(channel):
    """regen_index must not include archived entries."""
    from scripts.memory import regen_index
    # Archive the entry first.
    archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    # Re-create a live entry with a different slug.
    (channel / "prompt-hamsa" / "y.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: y\n"
        "created: 2026-05-01\nupdated: 2026-05-01\ntags: [t]\n---\n\n**Lesson:** live.\n"
    )
    regen_index(channel)
    idx = (channel / "INDEX.md").read_text()
    assert "prompt-hamsa/y" in idx
    assert "prompt-hamsa/x" not in idx


def test_apply_merge_writes_output_and_archives_inputs(channel):
    """A merge op writes the new entry and archives the inputs."""
    spec = channel / "prompt-hamsa"
    (spec / "a.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: a\n"
        "created: 2026-04-01\nupdated: 2026-04-01\ntags: [t1]\n---\n\n**Lesson:** a.\n"
    )
    (spec / "b.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: b\n"
        "created: 2026-04-08\nupdated: 2026-04-08\ntags: [t2]\n---\n\n**Lesson:** b.\n"
    )
    plan = {
        "plan_version": 1,
        "specialist": "prompt-hamsa",
        "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [
            {
                "op": "merge",
                "inputs": ["a", "b"],
                "output": {
                    "slug": "ab",
                    "tags": ["t1", "t2"],
                    "body": "**Lesson:** merged.\n**Supersedes:** a, b\n",
                },
                "reason": "stutter",
            },
        ],
    }
    from scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    new_path = spec / "ab.md"
    assert new_path.exists()
    txt = new_path.read_text()
    assert "slug: ab" in txt
    assert "**Supersedes:**" in txt
    assert not (spec / "a.md").exists()
    assert not (spec / "b.md").exists()
    assert (spec / ARCHIVE_DIRNAME / "2026-05-07" / "a.md").exists()
    assert (spec / ARCHIVE_DIRNAME / "2026-05-07" / "b.md").exists()


def test_apply_archive_moves_file(channel):
    """An archive op moves the file."""
    plan = {
        "plan_version": 1,
        "specialist": "prompt-hamsa",
        "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert not (channel / "prompt-hamsa" / "x.md").exists()
    assert (channel / "prompt-hamsa" / ARCHIVE_DIRNAME / "2026-05-07" / "x.md").exists()


def test_apply_summarize_behaves_like_merge(channel):
    """Summarize is mechanically identical to merge."""
    spec = channel / "prompt-hamsa"
    (spec / "a.md").write_text("---\nspecialist: prompt-hamsa\nscope: global\nslug: a\ncreated: 2026-04-01\nupdated: 2026-04-01\ntags: []\n---\n\n**Lesson:** a.\n")
    (spec / "b.md").write_text("---\nspecialist: prompt-hamsa\nscope: global\nslug: b\ncreated: 2026-04-08\nupdated: 2026-04-08\ntags: []\n---\n\n**Lesson:** b.\n")
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{
            "op": "summarize",
            "inputs": ["a", "b", "x"],
            "output": {"slug": "summary", "tags": [], "body": "**Lesson:** rolled up.\n"},
            "reason": "small entries",
        }],
    }
    from scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert (spec / "summary.md").exists()


def test_apply_defer_writes_to_deferred_log(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "defer", "target": "a-vs-b", "reason": "user call"}],
    }
    from scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["deferred"] == ["a-vs-b"]
    deferred_file = channel / ".deferred.md"
    assert deferred_file.is_file()
    txt = deferred_file.read_text()
    assert "a-vs-b" in txt
    assert "user call" in txt


def test_apply_keep_all_is_noop(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "keep_all", "slugs": ["x"], "reason": "distinct"}],
    }
    from scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert (channel / "prompt-hamsa" / "x.md").is_file()  # unchanged


def test_apply_is_idempotent_on_second_run(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from scripts.consolidate import apply_plan
    r1 = apply_plan(plan, channel, today="2026-05-07")
    assert r1["applied"] == 1
    r2 = apply_plan(plan, channel, today="2026-05-07")
    # Second run finds no source to archive — skipped, not error.
    assert r2["applied"] == 0
    assert r2["skipped"] == 1


def test_render_plan_for_user_groups_ops_by_kind(channel):
    """The user-facing rendering groups merge/archive/summarize/defer with counts."""
    from scripts.consolidate import render_plan_for_user
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [
            {"op": "merge", "inputs": ["a", "b"], "output": {"slug": "ab", "tags": [], "body": "X"}, "reason": "r1"},
            {"op": "archive", "slug": "c", "reason": "r2"},
            {"op": "defer", "target": "d-vs-e", "reason": "r3"},
        ],
    }
    md = render_plan_for_user(plan)
    assert "# Consolidation plan" in md
    assert "## Merges (1)" in md
    assert "## Archives (1)" in md
    assert "## Deferred (1)" in md
    assert "ab" in md and "c" in md and "d-vs-e" in md


def test_render_plan_for_user_tolerates_missing_reason():
    """A valid op that omits the optional 'reason' renders without KeyError.

    _validate_plan does not require 'reason', so an LLM-generated plan may omit
    it; the renderer must degrade gracefully instead of crashing the dry-run.
    """
    from scripts.consolidate import render_plan_for_user
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [
            {"op": "archive", "slug": "c"},  # no 'reason' key
        ],
    }
    md = render_plan_for_user(plan)
    assert "## Archives (1)" in md
    assert "(no reason given)" in md


def test_apply_writes_log_and_updates_meta(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from scripts.consolidate import apply_plan
    apply_plan(plan, channel, today="2026-05-07")
    log = (channel / ".consolidation.log").read_text()
    assert "archive prompt-hamsa x" in log
    meta_path = channel / "meta.json"
    import json
    meta = json.loads(meta_path.read_text())
    assert meta["last_consolidated"]["prompt-hamsa"].startswith("2026-05-07")


def test_infer_scope_buddy_home_memory_is_global(monkeypatch, tmp_path):
    from scripts import consolidate
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    root = tmp_path / "bh" / "memory"
    assert consolidate._infer_scope(root) == "global"


def test_infer_scope_project_buddy_is_project(tmp_path):
    from scripts import consolidate
    root = tmp_path / "myproj" / ".buddy" / "memory"
    assert consolidate._infer_scope(root) == "project"


def test_no_mirror_helper_remains():
    from scripts import consolidate
    assert not hasattr(consolidate, "_mirror_global_if_available")
