# buddy/tests/test_memory.py
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import memory  # noqa: E402


def test_mirror_machinery_removed():
    from scripts import memory
    for gone in ("mirror_global_write", "other_instance_dirs",
                 "current_instance_dir", "_load_registry"):
        assert not hasattr(memory, gone), f"{gone} should be deleted"


def test_regen_index_reads_frontmatter_and_writes_index(tmp_path):
    root = tmp_path / "memory"
    yeti_dir = root / "debugging-yeti"
    yeti_dir.mkdir(parents=True)
    (yeti_dir / "flaky-tests.md").write_text(
        "---\n"
        "specialist: debugging-yeti\n"
        "scope: project\n"
        "slug: flaky-tests\n"
        "created: 2026-05-05\n"
        "updated: 2026-05-05\n"
        "tags: [flaky-tests]\n"
        "---\n"
        "**Lesson:** Run flaky tests 50 times before declaring them fixed.\n"
        "**Why:** ...\n"
    )
    (root / "common").mkdir()
    (root / "common" / "no-mocks.md").write_text(
        "---\n"
        "specialist: common\n"
        "scope: project\n"
        "slug: no-mocks\n"
        "created: 2026-05-05\n"
        "updated: 2026-05-05\n"
        "tags: [testing]\n"
        "---\n"
        "**Lesson:** This repo bans mocks in integration tests.\n"
    )

    memory.regen_index(root)

    idx = (root / "INDEX.md").read_text()
    assert "[debugging-yeti/flaky-tests](debugging-yeti/flaky-tests.md)" in idx
    assert "Run flaky tests 50 times" in idx
    assert "[common/no-mocks](common/no-mocks.md)" in idx


def test_read_index_returns_entries(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    (root / "INDEX.md").write_text(
        "- [debugging-yeti/flaky-tests](debugging-yeti/flaky-tests.md) — Run flaky tests 50 times\n"
        "- [common/no-mocks](common/no-mocks.md) — No mocks in integration tests\n"
    )
    entries = memory.read_index(root)
    assert entries == [
        ("debugging-yeti/flaky-tests", "debugging-yeti/flaky-tests.md", "Run flaky tests 50 times"),
        ("common/no-mocks", "common/no-mocks.md", "No mocks in integration tests"),
    ]


def test_read_index_missing_returns_empty(tmp_path):
    assert memory.read_index(tmp_path / "missing") == []


def test_regen_index_skips_empty_body_gracefully(tmp_path):
    root = tmp_path / "memory"
    yeti_dir = root / "debugging-yeti"
    yeti_dir.mkdir(parents=True)
    (yeti_dir / "empty-body.md").write_text(
        "---\n"
        "specialist: debugging-yeti\n"
        "scope: project\n"
        "slug: empty-body\n"
        "created: 2026-05-05\n"
        "updated: 2026-05-05\n"
        "tags: []\n"
        "---\n"
    )
    memory.regen_index(root)
    idx = (root / "INDEX.md").read_text()
    assert "[debugging-yeti/empty-body](debugging-yeti/empty-body.md)" in idx
