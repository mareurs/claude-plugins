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
