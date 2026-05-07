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
