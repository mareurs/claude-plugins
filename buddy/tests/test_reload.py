"""Tests for reload.py — SKILL.md 3-scope discovery + reload block emission."""
import os
from pathlib import Path

import pytest


def test_find_skill_md_project_scope(tmp_path, monkeypatch):
    from scripts.reload import find_skill_md
    project = tmp_path / "proj"
    proj_skill = project / ".claude" / "buddy" / "skills" / "foo-bar" / "SKILL.md"
    proj_skill.parent.mkdir(parents=True)
    proj_skill.write_text("# proj foo-bar")

    result = find_skill_md("foo-bar", plugin_root=tmp_path / "plug",
                           project_root=project, home=tmp_path / "home")
    assert result == proj_skill


def test_find_skill_md_global_scope_when_no_project(tmp_path):
    from scripts.reload import find_skill_md
    home = tmp_path / "home"
    global_skill = home / ".claude" / "buddy" / "skills" / "foo-bar" / "SKILL.md"
    global_skill.parent.mkdir(parents=True)
    global_skill.write_text("# global foo-bar")

    result = find_skill_md("foo-bar", plugin_root=tmp_path / "plug",
                           project_root=tmp_path / "proj", home=home)
    assert result == global_skill


def test_find_skill_md_builtin_scope_when_no_global_or_project(tmp_path):
    from scripts.reload import find_skill_md
    plug = tmp_path / "plug"
    builtin_skill = plug / "skills" / "foo-bar" / "SKILL.md"
    builtin_skill.parent.mkdir(parents=True)
    builtin_skill.write_text("# builtin foo-bar")

    result = find_skill_md("foo-bar", plugin_root=plug,
                           project_root=tmp_path / "proj", home=tmp_path / "home")
    assert result == builtin_skill


def test_find_skill_md_precedence_project_over_global_over_builtin(tmp_path):
    from scripts.reload import find_skill_md
    plug = tmp_path / "plug"
    home = tmp_path / "home"
    project = tmp_path / "proj"

    for root in [plug / "skills" / "foo" / "SKILL.md",
                 home / ".claude" / "buddy" / "skills" / "foo" / "SKILL.md",
                 project / ".claude" / "buddy" / "skills" / "foo" / "SKILL.md"]:
        root.parent.mkdir(parents=True)
        root.write_text(f"# {root}")

    result = find_skill_md("foo", plugin_root=plug, project_root=project, home=home)
    assert "proj" in str(result)


def test_find_skill_md_returns_none_when_missing(tmp_path):
    from scripts.reload import find_skill_md
    result = find_skill_md("nope", plugin_root=tmp_path / "p",
                           project_root=tmp_path / "q", home=tmp_path / "h")
    assert result is None


def test_render_reload_block_contains_marker_and_skill_contents(tmp_path):
    from scripts.reload import render_reload_block
    plug = tmp_path / "plug"
    yeti = plug / "skills" / "debugging-yeti" / "SKILL.md"
    yeti.parent.mkdir(parents=True)
    yeti.write_text("# Debugging Yeti\nPatient. Methodical.")

    block = render_reload_block(
        specialists=["debugging-yeti"],
        new_sid="new-sid",
        prev_sid="prev-sid",
        source="resume",
        plugin_root=plug,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert "buddy:reloaded" in block
    assert "new-sid" in block
    assert "prev-sid" in block
    assert "resume" in block
    assert "Patient. Methodical." in block
    assert "debugging-yeti" in block
    assert "arrives" in block.lower()  # arrival-line directive


def test_render_reload_block_multiple_specialists_separator(tmp_path):
    from scripts.reload import render_reload_block
    plug = tmp_path / "plug"
    for name in ("debugging-yeti", "prompt-hamsa"):
        f = plug / "skills" / name / "SKILL.md"
        f.parent.mkdir(parents=True)
        f.write_text(f"# {name} content")

    block = render_reload_block(
        specialists=["debugging-yeti", "prompt-hamsa"],
        new_sid="n", prev_sid="p", source="compact",
        plugin_root=plug, project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert "debugging-yeti content" in block
    assert "prompt-hamsa content" in block


def test_render_reload_block_skips_missing_specialist(tmp_path):
    from scripts.reload import render_reload_block
    plug = tmp_path / "plug"
    f = plug / "skills" / "debugging-yeti" / "SKILL.md"
    f.parent.mkdir(parents=True)
    f.write_text("# yeti")

    block = render_reload_block(
        specialists=["debugging-yeti", "ghost-specialist"],
        new_sid="n", prev_sid="p", source="resume",
        plugin_root=plug, project_root=tmp_path / "proj", home=tmp_path / "home",
    )
    assert "debugging-yeti" in block
    # ghost is silently skipped — no crash
    assert "ghost-specialist" not in block or "(missing)" in block


def test_render_reload_block_empty_specialists_returns_empty(tmp_path):
    from scripts.reload import render_reload_block
    block = render_reload_block(
        specialists=[],
        new_sid="n", prev_sid="p", source="resume",
        plugin_root=tmp_path, project_root=tmp_path, home=tmp_path,
    )
    assert block == ""



def test_find_skill_md_sister_plugin_scope(tmp_path):
    """Sister-plugin scope: when plugin_root is in cache layout, find SKILL.md
    in sibling plugin's newest cached version."""
    from scripts.reload import find_skill_md
    # Simulate cache layout: <home>/.claude/plugins/cache/<marketplace>/buddy/<ver>
    cache = tmp_path / ".claude" / "plugins" / "cache" / "sdd-misc-plugins"
    buddy_root = cache / "buddy" / "0.7.7"
    buddy_root.mkdir(parents=True)
    # Sibling plugin with the target skill
    sibling_skill = cache / "codescout-companion" / "1.11.0" / "skills" / "reconnaissance" / "SKILL.md"
    sibling_skill.parent.mkdir(parents=True)
    sibling_skill.write_text("# Reconnaissance\nScout the seam.")

    result = find_skill_md(
        "reconnaissance",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert result == sibling_skill


def test_find_skill_md_sister_plugin_newest_version_wins(tmp_path):
    """When multiple cached versions of a sibling plugin exist, the newest
    (sort-descending by directory name) is picked."""
    from scripts.reload import find_skill_md
    cache = tmp_path / ".claude" / "plugins" / "cache" / "sdd-misc-plugins"
    buddy_root = cache / "buddy" / "0.7.7"
    buddy_root.mkdir(parents=True)
    old = cache / "codescout-companion" / "1.10.0" / "skills" / "reconnaissance" / "SKILL.md"
    new = cache / "codescout-companion" / "1.11.0" / "skills" / "reconnaissance" / "SKILL.md"
    for p, text in ((old, "old"), (new, "new")):
        p.parent.mkdir(parents=True)
        p.write_text(text)

    result = find_skill_md(
        "reconnaissance",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert result == new


def test_find_skill_md_sister_plugin_skipped_in_dev_layout(tmp_path):
    """Dev mode: plugin_root does not match cache layout — sister scope returns
    []. Falls through to None."""
    from scripts.reload import find_skill_md
    # Not under a 'cache' segment
    dev_root = tmp_path / "repo" / "buddy"
    dev_root.mkdir(parents=True)
    result = find_skill_md(
        "reconnaissance",
        plugin_root=dev_root,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert result is None


def test_find_skill_md_builtin_wins_over_sister(tmp_path):
    """Builtin scope (plugin_root/skills) wins over sister-plugin scope."""
    from scripts.reload import find_skill_md
    cache = tmp_path / ".claude" / "plugins" / "cache" / "sdd-misc-plugins"
    buddy_root = cache / "buddy" / "0.7.7"
    builtin = buddy_root / "skills" / "shared-skill" / "SKILL.md"
    builtin.parent.mkdir(parents=True)
    builtin.write_text("builtin")
    sister = cache / "other" / "1.0.0" / "skills" / "shared-skill" / "SKILL.md"
    sister.parent.mkdir(parents=True)
    sister.write_text("sister")

    result = find_skill_md(
        "shared-skill",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert result == builtin



def test_find_skill_md_sister_semver_sort_beats_lex(tmp_path):
    """1.11.0 must beat 1.9.9 — lex sort would pick 1.9.9 incorrectly."""
    from scripts.reload import find_skill_md
    cache = tmp_path / ".claude" / "plugins" / "cache" / "sdd-misc-plugins"
    buddy_root = cache / "buddy" / "0.7.8"
    buddy_root.mkdir(parents=True)
    old = cache / "codescout-companion" / "1.9.9" / "skills" / "reconnaissance" / "SKILL.md"
    new = cache / "codescout-companion" / "1.11.0" / "skills" / "reconnaissance" / "SKILL.md"
    for p, text in ((old, "old-1.9.9"), (new, "new-1.11.0")):
        p.parent.mkdir(parents=True)
        p.write_text(text)

    result = find_skill_md(
        "reconnaissance",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
        home=tmp_path / "home",
    )
    assert result == new
    assert result.read_text() == "new-1.11.0"


def test_semver_key_non_semver_sorts_lower(tmp_path):
    """Non-numeric version names (e.g. 'dev', '0.7.8-rc1') must not crash and
    sort BELOW real semvers — otherwise a stray 'tmp' dir could shadow real
    releases."""
    from scripts.reload import _semver_key
    assert _semver_key("1.11.0") > _semver_key("1.9.9")
    assert _semver_key("1.0.0") > _semver_key("0.99.99")
    # non-semver sorts lower
    assert _semver_key("dev") < _semver_key("0.0.1")
    assert _semver_key("0.7.8-rc1") < _semver_key("0.7.8")
