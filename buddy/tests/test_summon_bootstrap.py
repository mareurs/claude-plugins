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

    # Return is a compact pointer (A2): marker + payload-file, body NOT inlined.
    assert out.startswith("<!-- buddy:summon-payload specialist=foo-bar")
    assert "payload-file=.buddy/sid-1/summon-payload-foo-bar.md" in out
    assert "# The Foo Bar" not in out          # body spilled to file, not stdout
    payload = (project / ".buddy" / "sid-1" / "summon-payload-foo-bar.md").read_text()
    assert "name: Foo Bar" not in payload      # frontmatter stripped
    body_at = payload.index("# The Foo Bar")
    protocol_at = payload.index("## Memory Protocol")
    gates_at = payload.index("## Gates")
    assert body_at < protocol_at < gates_at
    # binding files absent in project → Live State soft-skipped entirely
    assert "## Live State" not in payload
def test_large_payload_spilled_not_inlined(plugin):
    plug, project = plugin
    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar", sid="sid-7"))
    # CC truncates a large stdout, so the hook returns a compact pointer, not body.
    assert out.startswith("<!-- buddy:summon-payload specialist=foo-bar")
    assert "payload-file=.buddy/sid-7/summon-payload-foo-bar.md" in out
    assert "## Gates" not in out
    spill = project / ".buddy" / "sid-7" / "summon-payload-foo-bar.md"
    assert spill.exists()
    payload = spill.read_text()
    assert "# The Foo Bar" in payload
    assert "## Gates" in payload
    assert not list(spill.parent.glob(".summon-payload-*.tmp"))   # temp cleaned up


def test_bindings_injected_when_files_exist(plugin):
    plug, project = plugin
    tracker = project / "docs" / "trackers" / "live.md"
    tracker.parent.mkdir(parents=True)
    tracker.write_text("# Live tracker\nstate row")
    mem = project / ".codescout" / "memories" / "gotchas.md"
    mem.parent.mkdir(parents=True)
    mem.write_text("# Gotchas\nrule one")

    out = sb.bootstrap(_event(project, "/buddy:summon foo-bar"))
    assert "payload-file=" in out
    payload = (project / ".buddy" / "sid-1" / "summon-payload-foo-bar.md").read_text()
    assert "## Live State" in payload
    assert "### Tracker: docs/trackers/live.md" in payload
    assert "state row" in payload
    assert "### codescout memory: gotchas" in payload
    assert "rule one" in payload


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
    payload = (project / ".buddy" / "sid-1" / "summon-payload-foo-bar.md").read_text()
    assert "## Memories — foo-bar POV" in payload
    proj_at = payload.index("project pov lesson")
    glob_at = payload.index("global pov lesson")
    assert proj_at < glob_at                   # Project section before Global
    assert "global common lesson" in payload


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
    assert "lens=alpha" in out.splitlines()[0]
    payload = (project / ".buddy" / "sid-1" / "summon-payload-foo-bar.md").read_text()
    assert "## Lens addendum — alpha" in payload
    assert "alpha lens text" in payload
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


# ------------------------------------------------- payload golden (pre-graph)

PAYLOAD_NOTE = (
    "The summon payload below was injected by buddy's prompt hook — "
    "the load steps in /buddy:summon are already done. Announce the "
    "specialist (italic arrival line) and adopt its voice for the "
    "rest of the session."
)


def test_payload_is_pinned_byte_for_byte(plugin):
    """Pins the payload build_payload produces TODAY, before fragments land.

    Captured from HEAD deliberately. A golden generated from the post-refactor
    code would assert that the new code equals itself and would stay green in a
    world where the fragment list silently drops gates.md.
    """
    plug, project = plugin
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    expected = "\n\n".join([
        "<!-- buddy:summon-payload specialist=foo-bar scope=builtin -->",
        PAYLOAD_NOTE,
        "# The Foo Bar\n\n## Voice\n\nCalm.",
        "## Memory Protocol\n\nprotocol text",
        "## Gates\n\ngates text",
    ])
    assert payload == expected

# ------------------------------------------------------------- fragments

def test_default_fragments_reproduce_todays_payload(plugin):
    """No `fragments:` key → identical to the Task 1 golden."""
    plug, project = plugin
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    assert "## Memory Protocol\n\nprotocol text" in payload
    assert "## Gates\n\ngates text" in payload
    assert payload.index("## Memory Protocol") < payload.index("## Gates")


def test_explicit_fragment_list_narrows_the_payload(plugin):
    """Declaring `fragments: [gates]` drops memory-protocol."""
    plug, project = plugin
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nfragments: [gates]\n---\n\n"
        + SKILL_BODY
    )
    payload = sb.build_payload("foo-bar", "builtin", skill, None, project)
    assert "gates text" in payload
    assert "protocol text" not in payload


def test_project_fragment_shadows_builtin(plugin):
    """project > global > builtin, asserted on the PROJECT text specifically.

    The project text is deliberately NOT a superstring of the builtin text: an
    assertion satisfied by substring would pass whether or not shadowing worked.
    """
    plug, project = plugin
    frag = project / ".buddy" / "fragments"
    frag.mkdir(parents=True)
    frag.joinpath("gates.md").write_text("PROJECT-ONLY gates")
    payload = sb.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )
    assert "PROJECT-ONLY gates" in payload
    assert "gates text" not in payload      # the builtin body is gone


def test_missing_fragment_is_soft_skipped(plugin):
    plug, project = plugin
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nfragments: [nope, gates]\n---\n\n"
        + SKILL_BODY
    )
    payload = sb.build_payload("foo-bar", "builtin", skill, None, project)
    assert payload is not None
    assert "gates text" in payload


# -------------------------------------------------------------- advisors

ADVISOR_SKILL = (
    "---\nname: Sec Ibex\ndescription: security\n---\n\n"
    "# The Security Ibex\n\n"
    "## Voice\n\nTerse and wary.\n\n"
    "## Operating Principles\n\n1. Trust nothing inbound.\n\n"
    "## Method — Three Phases\n\n### Phase 1 — Map\n\nMap the surface.\n\n"
    "## Test Format\n\nSEVERITY / ASSET / PATH\n\n"  # deliberately collides with the primary's heading — makes count()==1 at :358 a real discriminator
    "## Heuristics (universal)\n\n1. Every input is hostile.\n\n"
    "## Self-Traps (Failure Modes to Avoid)\n\n1. Auditing only the diff.\n"
)


@pytest.fixture
def plugin_with_advisor(plugin):
    plug, project = plugin
    (plug / "skills" / "sec-ibex").mkdir(parents=True)
    (plug / "skills" / "sec-ibex" / "SKILL.md").write_text(ADVISOR_SKILL)
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nadvisors: [sec-ibex]\n---\n\n"
        "# The Foo Bar\n\n## Voice\n\nCalm.\n\n"
        "## Test Format\n\nGIVEN / WHEN / THEN\n"
    )
    return plug, project


def _advised(sb_mod, plug, project):
    return sb_mod.build_payload(
        "foo-bar", "builtin", plug / "skills" / "foo-bar", None, project
    )


def test_advisor_contributes_its_projected_sections(plugin_with_advisor, monkeypatch):
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "sec-ibex": ("builtin", plug / "skills" / "sec-ibex"),
    })
    payload = _advised(sb, plug, project)
    assert "Trust nothing inbound." in payload
    assert "Every input is hostile." in payload
    assert "Auditing only the diff." in payload
    assert "advisor: sec-ibex" in payload


def test_advisor_voice_and_output_contract_are_NOT_projected(
    plugin_with_advisor, monkeypatch
):
    """LOAD-BEARING, and it looks redundant with the test above. It is not.

    A contains-check for the advisor's heuristics passes just as well if the
    WHOLE advisor file was appended. These exclusions are the only assertions
    that distinguish projection from concatenation. Deleting them re-opens a
    check that cannot fail (claude-plugins:W-4).

    ADVISOR_SKILL's `## Test Format` heading (renamed from `## Finding
    Format`) deliberately collides with the primary's own `## Test Format`
    heading — that collision is what makes `payload.count("## Test Format")
    == 1` below a real discriminator instead of a tautology. Reverting that
    heading back to `## Finding Format` silently re-vacuates this assertion.
    """
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "sec-ibex": ("builtin", plug / "skills" / "sec-ibex"),
    })
    payload = _advised(sb, plug, project)
    assert "Terse and wary." not in payload          # advisor Voice
    assert "SEVERITY / ASSET / PATH" not in payload  # advisor output contract
    assert "Map the surface." not in payload         # advisor Method
    assert payload.count("## Test Format") == 1      # primary's, exactly once
    assert "Calm." in payload                        # primary Voice survives


def test_unresolvable_advisor_is_soft_skipped(plugin_with_advisor, monkeypatch):
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
    })
    payload = _advised(sb, plug, project)
    assert payload is not None
    assert "Calm." in payload


def test_unresolvable_advisor_emits_a_warning_line(plugin_with_advisor, monkeypatch):
    """Soft-skip must be VISIBLE. A silently missing advisor is indistinguishable
    from an advisor with nothing to say."""
    plug, project = plugin_with_advisor
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
    })
    payload = _advised(sb, plug, project)
    assert "advisor 'sec-ibex' declared but not installed" in payload


def test_advisor_with_invalid_utf8_is_soft_skipped(plugin, monkeypatch):
    """A non-UTF-8 SKILL.md in an advisor must not take down the whole summon
    (claude-plugins ruling: "an advisor that does not resolve must never raise")
    — and the drop must be VISIBLE, not silent (Important 1, fix round 1): an
    installed-but-unreadable advisor is the same silent-content-drop defect
    class as a not-installed one.
    """
    plug, project = plugin
    bad = plug / "skills" / "bad-advisor"
    bad.mkdir(parents=True)
    (bad / "SKILL.md").write_bytes(
        b"---\nname: Bad\ndescription: t\n---\n\n# Bad\n\n\xff\xfe not valid utf-8\n"
    )
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nadvisors: [bad-advisor]\n---\n\n"
        "# The Foo Bar\n\n## Voice\n\nCalm.\n"
    )
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "bad-advisor": ("builtin", bad),
    })
    payload = _advised(sb, plug, project)
    assert payload is not None
    assert "Calm." in payload
    assert "advisor 'bad-advisor' is installed but unreadable" in payload


def test_advisor_with_no_advisor_role_sections_emits_a_warning_line(plugin, monkeypatch):
    """An advisor that resolves and is readable but contributes nothing
    (no Operating Principles/Heuristics/Self-Traps section) must still say
    so — the same silent-content-drop defect class as not-installed or
    unreadable (Important 1, fix round 1).
    """
    plug, project = plugin
    empty_advisor = plug / "skills" / "empty-advisor"
    empty_advisor.mkdir(parents=True)
    (empty_advisor / "SKILL.md").write_text(
        "---\nname: Empty\ndescription: t\n---\n\n"
        "# The Empty Advisor\n\n## Voice\n\nSilent.\n"
    )
    skill = plug / "skills" / "foo-bar"
    skill.joinpath("SKILL.md").write_text(
        "---\nname: Foo Bar\ndescription: t\nadvisors: [empty-advisor]\n---\n\n"
        "# The Foo Bar\n\n## Voice\n\nCalm.\n"
    )
    monkeypatch.setattr(sb, "discover", lambda root: {
        "foo-bar": ("builtin", plug / "skills" / "foo-bar"),
        "empty-advisor": ("builtin", empty_advisor),
    })
    payload = _advised(sb, plug, project)
    assert payload is not None
    assert "Calm." in payload
    assert "advisor 'empty-advisor' contributed no advisor-role sections" in payload


def test_project_advisor_matches_heading_variants():
    body = (
        "## Heuristics (universal)\n\nH text\n\n"
        "## Self-Traps (Failure Modes to Avoid)\n\nS text\n\n"
        "## Voice\n\nV text\n"
    )
    out = sb.project_advisor(body, "x")
    assert "H text" in out and "S text" in out
    assert "V text" not in out
