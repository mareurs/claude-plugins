"""Every declared edge in every shipped specialist must resolve.

An advisor or fragment naming something that is not installed fails silently --
as content that simply does not arrive. This is the defect class that made T-N
citations inert: a name nothing validates.
"""
from pathlib import Path

from scripts import summon_bootstrap as sb
from scripts.reload import parse_frontmatter

BUILTIN = Path(sb.PLUGIN_ROOT) / "skills"


def _declared(key: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for skill in sorted(BUILTIN.iterdir()):
        md = skill / "SKILL.md"
        if not md.is_file():
            continue
        meta = parse_frontmatter(md.read_text(encoding="utf-8"))
        values = meta.get(key)
        if isinstance(values, list):
            out.extend((skill.name, str(v)) for v in values)
        elif values is not None:
            # Present but not parsed as a list (e.g. `advisors: sec-ibex`, or
            # block-style YAML that parse_frontmatter can't read) is a failure
            # of its own -- the isinstance(values, list) guard used to make
            # this invisible to the lint (Important 2).
            out.append((skill.name, f"<unparsed {key}: {values!r}>"))
    return out


def test_every_declared_advisor_resolves():
    # Builtin scope only -- the docstring's claim is about every *shipped*
    # specialist. sb.discover(Path.cwd()) also layers in the developer's
    # $BUDDY_HOME global skills and <cwd>/.buddy/skills project skills, so an
    # advisor that only exists in this machine's global dir would pass here
    # and dangle for every other user -- and the verdict would silently
    # change with the invocation directory (Important 2, fix round 1).
    index = {
        p.name: ("builtin", p) for p in BUILTIN.iterdir() if (p / "SKILL.md").is_file()
    }
    missing = [(s, a) for s, a in _declared("advisors") if a not in index]
    assert not missing, f"advisors declared but not installed: {missing}"


def test_every_declared_fragment_resolves(tmp_path, monkeypatch):
    # resolve_fragment() always consults buddy_paths.global_root(), which
    # reads $BUDDY_HOME regardless of tmp_path -- pin BUDDY_HOME to tmp_path
    # so the developer's real global fragments dir can't leak in and the
    # verdict can't change with the invocation environment (Important 2,
    # fix round 1).
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path))
    missing = [
        (s, f)
        for s, f in _declared("fragments")
        if sb.resolve_fragment(f, tmp_path) is None
    ]
    assert not missing, f"fragments declared but not resolvable: {missing}"


def test_default_fragments_all_exist(tmp_path, monkeypatch):
    """Guards the default list itself -- the one nobody declares and everybody gets."""
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path))
    missing = [f for f in sb.DEFAULT_FRAGMENTS if sb.resolve_fragment(f, tmp_path) is None]
    assert not missing, f"DEFAULT_FRAGMENTS unresolvable: {missing}"


def test_default_fragments_all_exist_discriminates_from_a_leaked_global(tmp_path, monkeypatch):
    """Proves the BUDDY_HOME pin above actually matters (Important 3).

    Simulates the exact failure mode without touching the real machine: a
    builtin fragment is "deleted" (PLUGIN_ROOT/data points at an empty dir)
    while an unrelated, unpinned BUDDY_HOME happens to have a same-named
    global fragment. Without pinning BUDDY_HOME per-test, resolve_fragment
    leaks through that global copy and the missing builtin goes unnoticed --
    exactly the "passes by luck, not by construction" scenario the review
    flagged. Pinning BUDDY_HOME to a clean, empty dir (what the fixed test
    above does) exposes the gap instead.
    """
    fake_plugin = tmp_path / "fake_plugin"
    (fake_plugin / "data").mkdir(parents=True)
    # deliberately no gates.md here -- simulates a deleted buddy/data/gates.md
    monkeypatch.setattr(sb, "PLUGIN_ROOT", fake_plugin)

    leaked_home = tmp_path / "leaked_home"
    (leaked_home / "fragments").mkdir(parents=True)
    (leaked_home / "fragments" / "gates.md").write_text("leaked global gates")

    project = tmp_path / "proj"

    # Unpinned BUDDY_HOME (the pre-fix shape of the sibling test): the leaked
    # global fragment silently stands in for the missing builtin one.
    monkeypatch.setenv("BUDDY_HOME", str(leaked_home))
    assert sb.resolve_fragment("gates", project) is not None

    # Pinned BUDDY_HOME (the fix): the same missing-builtin state is now
    # correctly reported as unresolvable.
    clean_home = tmp_path / "clean_home"
    monkeypatch.setenv("BUDDY_HOME", str(clean_home))
    assert sb.resolve_fragment("gates", project) is None
