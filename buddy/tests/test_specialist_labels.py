"""Tests for specialist_labels.py — slug → plain label resolution."""
from pathlib import Path


def test_frontmatter_name_wins(tmp_path):
    from scripts.specialist_labels import resolve_label
    plug = tmp_path / "plug"
    skill = plug / "skills" / "pika" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: Pika Project Watchdog\n---\n# Header Title\nbody")
    label = resolve_label(
        "pika", plugin_root=plug, project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert label == "Pika Project Watchdog"


def test_h1_fallback_strips_the_prefix(tmp_path):
    from scripts.specialist_labels import resolve_label
    plug = tmp_path / "plug"
    skill = plug / "skills" / "debugging-yeti" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# The Debugging Yeti\n\n## Voice\nMeasured.")
    label = resolve_label(
        "debugging-yeti", plugin_root=plug,
        project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert label == "Debugging Yeti"


def test_h1_without_the_prefix_preserved(tmp_path):
    from scripts.specialist_labels import resolve_label
    plug = tmp_path / "plug"
    skill = plug / "skills" / "snow-owl" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# Snow Owl\nbody")
    label = resolve_label(
        "snow-owl", plugin_root=plug,
        project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert label == "Snow Owl"


def test_missing_skill_falls_back_to_humanized_slug(tmp_path):
    from scripts.specialist_labels import resolve_label
    label = resolve_label(
        "ghost-bird", plugin_root=tmp_path / "plug",
        project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert label == "Ghost Bird"


def test_project_scope_overrides_builtin(tmp_path):
    from scripts.specialist_labels import resolve_label
    plug = tmp_path / "plug"
    proj = tmp_path / "proj"
    builtin = plug / "skills" / "shared" / "SKILL.md"
    builtin.parent.mkdir(parents=True)
    builtin.write_text("# Builtin Shape\n")
    project = proj / ".claude" / "buddy" / "skills" / "shared" / "SKILL.md"
    project.parent.mkdir(parents=True)
    project.write_text("# Project Shape\n")
    label = resolve_label(
        "shared", plugin_root=plug, project_root=proj, home=tmp_path / "home",
    )
    assert label == "Project Shape"


def test_resolve_labels_preserves_order(tmp_path):
    from scripts.specialist_labels import resolve_labels
    plug = tmp_path / "plug"
    for slug, h1 in [("aa", "# Alpha"), ("bb", "# Beta")]:
        f = plug / "skills" / slug / "SKILL.md"
        f.parent.mkdir(parents=True)
        f.write_text(h1)
    pairs = resolve_labels(
        ["bb", "aa"], plugin_root=plug,
        project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert pairs == [("bb", "Beta"), ("aa", "Alpha")]
