# buddy/tests/test_memory.py
import json
import os
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import memory  # noqa: E402


def write_instances(tmp_path: Path, paths: list[str]) -> Path:
    p = tmp_path / "instances.json"
    p.write_text(json.dumps({"instances": paths}))
    return p


def test_current_instance_dir_detects_from_plugin_root(tmp_path, monkeypatch):
    fake_claude = tmp_path / "claude"
    fake_plugin = fake_claude / "plugins" / "cache" / "x" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    assert memory.current_instance_dir() == fake_claude


def test_other_instance_dirs_excludes_current(tmp_path, monkeypatch):
    a = tmp_path / "claude"; a.mkdir()
    b = tmp_path / "claude-sdd"; b.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(b)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)
    assert memory.other_instance_dirs() == [b]


def test_other_instance_dirs_skips_missing(tmp_path, monkeypatch):
    a = tmp_path / "claude"; a.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(tmp_path / "nope")])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)
    assert memory.other_instance_dirs() == []


def test_mirror_global_write_copies_to_other_instances(tmp_path, monkeypatch):
    a = tmp_path / "claude"
    b = tmp_path / "claude-sdd"
    (a / "buddy" / "memory" / "debugging-yeti").mkdir(parents=True)
    b.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(b)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)

    src_rel = Path("debugging-yeti/flaky-tests.md")
    src_abs = a / "buddy" / "memory" / src_rel
    src_abs.write_text("---\nslug: flaky-tests\n---\nbody")

    written = memory.mirror_global_write(src_rel)

    assert b / "buddy" / "memory" / src_rel in written
    assert (b / "buddy" / "memory" / src_rel).read_text() == "---\nslug: flaky-tests\n---\nbody"


def test_mirror_global_write_noop_when_no_other_instances(tmp_path, monkeypatch):
    a = tmp_path / "claude"
    (a / "buddy" / "memory" / "common").mkdir(parents=True)
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)

    src_rel = Path("common/no-mocks-in-it.md")
    (a / "buddy" / "memory" / src_rel).write_text("body")
    assert memory.mirror_global_write(src_rel) == []


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
