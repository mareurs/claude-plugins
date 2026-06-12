"""Tests for summon_bootstrap.py — hook-side summon payload assembly."""
import json
from pathlib import Path

import pytest

from scripts import summon_bootstrap as sb


# ---------------------------------------------------------------- fixtures

SKILL_BODY = "# The Foo Bar\n\n## Voice\n\nCalm.\n"
SKILL_WITH_FM = (
    "---\nname: Foo Bar\ndescription: test specialist\n"
    "inject_trackers: [docs/trackers/live.md]\n"
    "inject_memory_topics: [gotchas]\n---\n\n" + SKILL_BODY
)


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    """Fake plugin root with one builtin specialist + data files; fake project."""
    plug = tmp_path / "plug"
    (plug / "skills" / "foo-bar").mkdir(parents=True)
    (plug / "skills" / "foo-bar" / "SKILL.md").write_text(SKILL_WITH_FM)
    (plug / "data").mkdir()
    (plug / "data" / "memory-protocol.md").write_text("protocol text")
    (plug / "data" / "gates.md").write_text("gates text")

    project = tmp_path / "proj"
    (project / ".buddy").mkdir(parents=True)

    monkeypatch.setattr(sb, "PLUGIN_ROOT", plug)
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))

    def fake_discover(project_root: Path):
        return {"foo-bar": ("builtin", plug / "skills" / "foo-bar")}
    monkeypatch.setattr(sb, "discover", fake_discover)
    return plug, project


def _event(project: Path, prompt: str, sid: str = "sid-1") -> dict:
    return {"prompt": prompt, "cwd": str(project), "session_id": sid}


# ---------------------------------------------------------------- resolution

def test_resolve_exact_and_unique_substring():
    index = {"foo-bar": ("builtin", Path("/x")), "baz-qux": ("builtin", Path("/y"))}
    assert sb.resolve("foo-bar", index) == "foo-bar"
    assert sb.resolve("foo", index) == "foo-bar"
    assert sb.resolve("foo bar", index) == "foo-bar"   # space → kebab
    assert sb.resolve("zzz", index) is None


def test_resolve_ambiguous_declines():
    index = {"foo-bar": ("b", Path("/x")), "foo-baz": ("b", Path("/y"))}
    assert sb.resolve("foo", index) is None


def test_resolve_with_lens_forms():
    index = {"data-leakage": ("b", Path("/x"))}
    assert sb.resolve_with_lens("data-leakage:llm", index) == ("data-leakage", "llm")
    assert sb.resolve_with_lens("data llm", index) == ("data-leakage", "llm")
    assert sb.resolve_with_lens("", index) == (None, None)


# ---------------------------------------------------------------- bootstrap

def test_payload_assembly_order_and_frontmatter_strip(plugin):
    plug, project = plugin
    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))

    assert out.startswith("<!-- buddy:summon-payload specialist=foo-bar")
    assert "name: Foo Bar" not in out          # frontmatter stripped
    body_at = out.index("# The Foo Bar")
    protocol_at = out.index("## Memory Protocol")
    gates_at = out.index("## Gates")
    assert body_at < protocol_at < gates_at
    # binding files absent in project → Live State soft-skipped entirely
    assert "## Live State" not in out


def test_bindings_injected_when_files_exist(plugin):
    plug, project = plugin
    tracker = project / "docs" / "trackers" / "live.md"
    tracker.parent.mkdir(parents=True)
    tracker.write_text("# Live tracker\nstate row")
    mem = project / ".codescout" / "memories" / "gotchas.md"
    mem.parent.mkdir(parents=True)
    mem.write_text("# Gotchas\nrule one")

    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    assert "## Live State" in out
    assert "### Tracker: docs/trackers/live.md" in out
    assert "state row" in out
    assert "### codescout memory: gotchas" in out
    assert "rule one" in out


def test_memories_injected_pov_then_common(plugin, tmp_path):
    plug, project = plugin
    global_mem = tmp_path / "bh" / "memory"
    (global_mem / "foo-bar").mkdir(parents=True)
    (global_mem / "foo-bar" / "a.md").write_text("global pov lesson")
    (global_mem / "common").mkdir()
    (global_mem / "common" / "b.md").write_text("global common lesson")
    proj_mem = project / ".buddy" / "memory" / "foo-bar"
    proj_mem.mkdir(parents=True)
    (proj_mem / "c.md").write_text("project pov lesson")

    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    assert "## Memories — foo-bar POV" in out
    proj_at = out.index("project pov lesson")
    glob_at = out.index("global pov lesson")
    assert proj_at < glob_at                   # Project section before Global
    assert "global common lesson" in out


def test_dedup_marker_on_second_summon(plugin):
    plug, project = plugin
    first = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    assert "buddy:summon-payload" in first
    second = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    assert "buddy:summon-already-active" in second
    assert "# The Foo Bar" not in second       # no payload re-injection


def test_tracking_state_written_hook_side(plugin):
    plug, project = plugin
    sb.bootstrap(_event(project, "/buddy:summon foo-bar", sid="sid-9"))
    state = json.loads(
        (project / ".buddy" / "sid-9" / "state.json").read_text()
    )
    assert "foo-bar" in state["active_specialists"]


def test_unresolvable_and_empty_args_decline(plugin):
    plug, project = plugin
    assert sb.bootstrap(_event(project, "/buddy:summon zzz")) == ""
    assert sb.bootstrap(_event(project, "/buddy:summon")) == ""
    assert sb.bootstrap(_event(project, "unrelated prompt")) == ""


def test_required_lens_missing_declines(plugin):
    plug, project = plugin
    (plug / "skills" / "foo-bar" / "_alpha.md").write_text("alpha lens text")

    assert sb.bootstrap(_event(project, "/buddy:summon foo-bar")) == ""
    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar:alpha"))
    assert "## Lens addendum — alpha" in out
    assert "alpha lens text" in out
    assert sb.bootstrap(_event(project, "/buddy:summon foo-bar:nope", sid="s2")) == ""


def test_lens_on_lensless_specialist_ignored(plugin):
    plug, project = plugin
    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar:extra"))
    assert "buddy:summon-payload specialist=foo-bar" in out
    assert "lens=" not in out.splitlines()[0]


def test_summons_log_appended(plugin, tmp_path):
    plug, project = plugin
    sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    log = tmp_path / "bh" / "summons.log"
    assert log.is_file()
    assert "foo-bar\tsummoned" in log.read_text()


def test_bootstrap_never_raises_on_garbage(monkeypatch, tmp_path):
    # Isolate from the real plugin: no discovery hits, no real ~/.buddy writes.
    monkeypatch.setattr(sb, "discover", lambda project_root: {})
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    assert sb.bootstrap({}) == ""
    assert sb.bootstrap({"prompt": "/buddy:summon x", "cwd": "/nonexistent-dir-xyz"}) == ""


def test_resolve_short_fragment_declines():
    index = {"security-ibex": ("builtin", Path("/x"))}
    assert sb.resolve("x", index) is None      # <3 chars: no substring match
    assert sb.resolve("ibex", index) == "security-ibex"
