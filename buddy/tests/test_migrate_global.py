"""Tests for scripts/migrate_global.py — per-profile → ~/.buddy merge."""
import time
from pathlib import Path

from scripts import migrate_global as migrate


def _profile(home: Path, name: str):
    d = home / name / "buddy"
    d.mkdir(parents=True)
    return d


def test_copies_absent_files(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "codescout-pika").mkdir(parents=True)
    (p / "skills" / "codescout-pika" / "SKILL.md").write_text("pika\n")
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "codescout-pika" / "SKILL.md").read_text() == "pika\n"


def test_identical_is_deduped_no_backup(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    for prof in (".claude-sdd", ".claude-kat"):
        p = _profile(home, prof)
        (p / "skills" / "x").mkdir(parents=True)
        (p / "skills" / "x" / "SKILL.md").write_text("same\n")
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "x" / "SKILL.md").read_text() == "same\n"
    assert not (dest / ".migration-backup").exists()


def test_divergent_newest_wins_loser_archived(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    older = _profile(home, ".claude-sdd")
    (older / "skills" / "x").mkdir(parents=True)
    f_old = older / "skills" / "x" / "SKILL.md"
    f_old.write_text("OLD\n")
    newer = _profile(home, ".claude-kat")
    (newer / "skills" / "x").mkdir(parents=True)
    f_new = newer / "skills" / "x" / "SKILL.md"
    f_new.write_text("NEW\n")
    import os
    os.utime(f_old, (1000, 1000))
    os.utime(f_new, (2000, 2000))
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "x" / "SKILL.md").read_text() == "NEW\n"
    backups = list((dest / ".migration-backup").rglob("SKILL.md"))
    assert any(b.read_text() == "OLD\n" for b in backups)


def test_summons_log_union_sorted_deduped(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    a = _profile(home, ".claude")
    (a / "summons.log").write_text("2026-01-02 yeti\n2026-01-01 crane\n")
    b = _profile(home, ".claude-sdd")
    (b / "summons.log").write_text("2026-01-02 yeti\n2026-01-03 ibex\n")
    migrate.run(home=home, dest=dest, apply=True)
    lines = (dest / "summons.log").read_text().splitlines()
    assert lines == ["2026-01-01 crane", "2026-01-02 yeti", "2026-01-03 ibex"]


def test_dry_run_writes_nothing(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "x").mkdir(parents=True)
    (p / "skills" / "x" / "SKILL.md").write_text("y\n")
    migrate.run(home=home, dest=dest, apply=False)
    assert not dest.exists()


def test_idempotent_rerun_is_noop(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "x").mkdir(parents=True)
    (p / "skills" / "x" / "SKILL.md").write_text("y\n")
    first = migrate.run(home=home, dest=dest, apply=True)
    second = migrate.run(home=home, dest=dest, apply=True)
    assert second["copied"] == 0
    assert second["conflicts"] == 0


def test_three_way_divergence_archives_losers_by_origin(tmp_path):
    import os
    home = tmp_path
    dest = tmp_path / ".buddy"
    contents = {".claude": ("A\n", 1000), ".claude-sdd": ("B\n", 2000), ".claude-kat": ("C\n", 3000)}
    for prof, (text, mt) in contents.items():
        p = _profile(home, prof)
        (p / "skills" / "x").mkdir(parents=True)
        f = p / "skills" / "x" / "SKILL.md"
        f.write_text(text)
        os.utime(f, (mt, mt))
    migrate.run(home=home, dest=dest, apply=True)
    # Newest (C, from .claude-kat) wins.
    assert (dest / "skills" / "x" / "SKILL.md").read_text() == "C\n"
    # Losers archived under their ORIGIN profile dirs.
    assert (dest / ".migration-backup" / ".claude" / "skills" / "x" / "SKILL.md").read_text() == "A\n"
    assert (dest / ".migration-backup" / ".claude-sdd" / "skills" / "x" / "SKILL.md").read_text() == "B\n"
