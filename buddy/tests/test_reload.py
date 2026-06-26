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
                           project_root=project)
    assert result == proj_skill


def test_find_skill_md_global_scope_when_no_project(tmp_path, monkeypatch):
    from scripts.reload import find_skill_md
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    global_skill = tmp_path / "bh" / "skills" / "foo-bar" / "SKILL.md"
    global_skill.parent.mkdir(parents=True)
    global_skill.write_text("# global foo-bar")

    result = find_skill_md("foo-bar", plugin_root=tmp_path / "plug",
                           project_root=tmp_path / "proj")
    assert result == global_skill


def test_find_skill_md_builtin_scope_when_no_global_or_project(tmp_path):
    from scripts.reload import find_skill_md
    plug = tmp_path / "plug"
    builtin_skill = plug / "skills" / "foo-bar" / "SKILL.md"
    builtin_skill.parent.mkdir(parents=True)
    builtin_skill.write_text("# builtin foo-bar")

    result = find_skill_md("foo-bar", plugin_root=plug,
                           project_root=tmp_path / "proj")
    assert result == builtin_skill


def test_find_skill_md_precedence_project_over_global_over_builtin(tmp_path, monkeypatch):
    from scripts.reload import find_skill_md
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    plug = tmp_path / "plug"
    project = tmp_path / "proj"

    for root in [plug / "skills" / "foo" / "SKILL.md",
                 tmp_path / "bh" / "skills" / "foo" / "SKILL.md",
                 project / ".claude" / "buddy" / "skills" / "foo" / "SKILL.md"]:
        root.parent.mkdir(parents=True)
        root.write_text(f"# {root}")

    result = find_skill_md("foo", plugin_root=plug, project_root=project)
    assert "proj" in str(result)


def test_find_skill_md_returns_none_when_missing(tmp_path):
    from scripts.reload import find_skill_md
    result = find_skill_md("nope", plugin_root=tmp_path / "p",
                           project_root=tmp_path / "q")
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
        plugin_root=plug, project_root=tmp_path / "proj",
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
        plugin_root=plug, project_root=tmp_path / "proj",
    )
    assert "debugging-yeti" in block
    # ghost is silently skipped — no crash
    assert "ghost-specialist" not in block or "(missing)" in block


def test_render_reload_block_empty_specialists_returns_empty(tmp_path):
    from scripts.reload import render_reload_block
    block = render_reload_block(
        specialists=[],
        new_sid="n", prev_sid="p", source="resume",
        plugin_root=tmp_path, project_root=tmp_path,
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
    )
    assert result is None


def test_find_skill_md_sibling_repo_scope_flat_dev_layout(tmp_path):
    """Flat dev/source-repo layout: sibling plugins sit directly beside
    plugin_root with no version dir. A cross-plugin skill like reconnaissance,
    shipped by a sibling (codescout-companion), resolves via the sibling scope
    even though the cache-layout sister scope returns []."""
    from scripts.reload import find_skill_md
    repo = tmp_path / "claude-plugins"
    buddy_root = repo / "buddy"
    buddy_root.mkdir(parents=True)
    sibling_skill = repo / "codescout-companion" / "skills" / "reconnaissance" / "SKILL.md"
    sibling_skill.parent.mkdir(parents=True)
    sibling_skill.write_text("# Reconnaissance\nScout the seam.")

    result = find_skill_md(
        "reconnaissance",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
    )
    assert result == sibling_skill


def test_find_skill_md_builtin_wins_over_sibling_repo(tmp_path):
    """Builtin scope (3) outranks the flat sibling scope (5): when buddy itself
    ships the skill, the sibling copy is not consulted."""
    from scripts.reload import find_skill_md
    repo = tmp_path / "claude-plugins"
    buddy_root = repo / "buddy"
    builtin = buddy_root / "skills" / "reconnaissance" / "SKILL.md"
    builtin.parent.mkdir(parents=True)
    builtin.write_text("# builtin recon")
    sibling = repo / "codescout-companion" / "skills" / "reconnaissance" / "SKILL.md"
    sibling.parent.mkdir(parents=True)
    sibling.write_text("# sibling recon")

    result = find_skill_md(
        "reconnaissance",
        plugin_root=buddy_root,
        project_root=tmp_path / "proj",
    )
    assert result == builtin


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


def test_global_skill_resolved_from_buddy_home(tmp_path, monkeypatch):
    from scripts.reload import find_skill_md
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    skill = tmp_path / "bh" / "skills" / "codescout-pika" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# pika\n")
    found = find_skill_md(
        "codescout-pika",
        plugin_root=tmp_path / "plugin",
        project_root=tmp_path / "proj",
    )
    assert found == skill


# --- frontmatter handling (2026-06-12 skill-loading bootstrap) ---

def test_strip_frontmatter_removes_leading_block():
    from scripts.reload import strip_frontmatter
    text = "---\nname: Foo\ndescription: bar\n---\n\n# The Foo\n\nbody"
    assert strip_frontmatter(text) == "# The Foo\n\nbody"


def test_strip_frontmatter_noop_without_block():
    from scripts.reload import strip_frontmatter
    assert strip_frontmatter("# The Foo\n--- not frontmatter") == "# The Foo\n--- not frontmatter"


def test_parse_frontmatter_flat_keys_and_inline_arrays():
    from scripts.reload import parse_frontmatter
    text = (
        "---\nname: Foo Bar\ndescription: does things\n"
        "inject_trackers: [docs/trackers/a.md, docs/trackers/b.md]\n"
        "inject_memory_topics: [gotchas]\n---\n# body"
    )
    meta = parse_frontmatter(text)
    assert meta["name"] == "Foo Bar"
    assert meta["inject_trackers"] == ["docs/trackers/a.md", "docs/trackers/b.md"]
    assert meta["inject_memory_topics"] == ["gotchas"]


def test_parse_frontmatter_empty_without_block():
    from scripts.reload import parse_frontmatter
    assert parse_frontmatter("# no frontmatter here") == {}


def test_render_reload_block_strips_frontmatter(tmp_path):
    from scripts.reload import render_reload_block
    plug = tmp_path / "plug"
    skill = plug / "skills" / "foo" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: Foo\n---\n\n# The Foo\n\nvoice text")

    block = render_reload_block(
        ["foo"], new_sid="n", prev_sid="p", source="compact",
        plugin_root=plug, project_root=tmp_path / "proj",
    )
    assert "# The Foo" in block
    assert "name: Foo" not in block


def test_render_dismissal_notice_lists_names_and_instruction():
    from scripts.reload import render_dismissal_notice
    notice = render_dismissal_notice(
        ["debugging-yeti", "prompt-hamsa"],
        new_sid="new", prev_sid="prev", source="compact",
    )
    assert "buddy:dismissed-on-compact" in notice
    assert "debugging-yeti" in notice
    assert "prompt-hamsa" in notice
    assert "/buddy:summon" in notice
    # Release, don't re-inject: no SKILL.md bodies, no reload marker.
    assert "buddy:reloaded" not in notice


def test_render_dismissal_notice_empty_returns_empty():
    from scripts.reload import render_dismissal_notice
    assert render_dismissal_notice([], new_sid="n", prev_sid="p", source="compact") == ""
