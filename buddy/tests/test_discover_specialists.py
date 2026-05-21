"""Tests for discover-specialists.sh — three-scope specialist discovery.

Regression coverage for the "pika not found" bug: a global-scope specialist
was invisible because CLAUDE_DIR was derived solely by walking the plugin
root's ancestors for a `.claude*` component. For a directory-source install
whose installPath points at the plugin *source* dir (not the cache under a
profile), that walk yields nothing and global scope is silently skipped.

Fix: resolve the active profile from $CLAUDE_CONFIG_DIR first, falling back
to the ancestor walk only when it is unset.
"""
import os
import shutil
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "discover-specialists.sh"


def _run(*, cwd=None, env=None, script=None, args=()):
    e = os.environ.copy()
    # Strip inherited profile/project signals so each test controls them.
    e.pop("CLAUDE_CONFIG_DIR", None)
    e.pop("CLAUDE_PROJECT_DIR", None)
    e.pop("CLAUDE_PLUGIN_ROOT", None)
    if env:
        e.update(env)
    return subprocess.run(
        ["bash", str(script or SCRIPT), *args],
        cwd=str(cwd) if cwd else None, env=e,
        capture_output=True, text=True,
    )


def _make_specialist(root: Path, name: str):
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"# {name}\n")
    return d


def _scopes(stdout: str):
    """Parse 'scope name path' lines into a set of (scope, name) pairs."""
    return {tuple(line.split()[:2]) for line in stdout.splitlines() if line.strip()}


def test_builtin_scope_discovered(tmp_path):
    """Self-location finds the shipped builtin specialists without any env."""
    r = _run(cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    pairs = _scopes(r.stdout)
    assert ("builtin", "debugging-yeti") in pairs
    # builtin must resolve even when CLAUDE_PLUGIN_ROOT is unset.
    assert any(scope == "builtin" for scope, _ in pairs)


def test_global_scope_via_claude_config_dir(tmp_path):
    """THE pika regression: a global specialist is found via CLAUDE_CONFIG_DIR
    even though the plugin root has no `.claude*` ancestor."""
    profile = tmp_path / "profile"
    _make_specialist(profile / "buddy" / "skills", "codescout-pika")
    r = _run(cwd=tmp_path, env={"CLAUDE_CONFIG_DIR": str(profile)})
    assert r.returncode == 0, r.stderr
    assert ("global", "codescout-pika") in _scopes(r.stdout)


def test_project_scope_via_claude_project_dir(tmp_path):
    proj = tmp_path / "proj"
    _make_specialist(proj / ".buddy" / "skills", "proj-only-spec")
    r = _run(cwd=tmp_path, env={"CLAUDE_PROJECT_DIR": str(proj)})
    assert r.returncode == 0, r.stderr
    assert ("project", "proj-only-spec") in _scopes(r.stdout)


def test_config_dir_without_buddy_skills_is_silent(tmp_path):
    """CLAUDE_CONFIG_DIR set but no buddy/skills under it → no global rows,
    no error (the common main-profile case)."""
    profile = tmp_path / "profile"
    profile.mkdir()
    r = _run(cwd=tmp_path, env={"CLAUDE_CONFIG_DIR": str(profile)})
    assert r.returncode == 0, r.stderr
    assert not any(scope == "global" for scope, _ in _scopes(r.stdout))


def test_ancestor_walk_fallback_when_config_dir_unset(tmp_path):
    """When CLAUDE_CONFIG_DIR is unset, the script falls back to walking its
    own ancestors for a `.claude*` component. Verified with a copy of the
    script planted inside a fake cached install tree."""
    cache = tmp_path / ".claude-sdd" / "plugins" / "cache" / "m" / "buddy" / "9.9.9"
    (cache / "scripts").mkdir(parents=True)
    (cache / "skills").mkdir(parents=True)  # builtin scope for the copy
    shutil.copy(SCRIPT, cache / "scripts" / "discover-specialists.sh")
    # global specialist under the profile root the ancestor walk should find.
    _make_specialist(tmp_path / ".claude-sdd" / "buddy" / "skills", "fallback-spec")

    r = _run(cwd=tmp_path, script=cache / "scripts" / "discover-specialists.sh")
    assert r.returncode == 0, r.stderr
    assert ("global", "fallback-spec") in _scopes(r.stdout)


def test_config_dir_takes_precedence_over_ancestor_walk(tmp_path):
    """If both signals are present, CLAUDE_CONFIG_DIR wins — the planted-copy
    profile is ignored in favour of the explicit config dir."""
    cache = tmp_path / ".claude-sdd" / "plugins" / "cache" / "m" / "buddy" / "9.9.9"
    (cache / "scripts").mkdir(parents=True)
    (cache / "skills").mkdir(parents=True)
    shutil.copy(SCRIPT, cache / "scripts" / "discover-specialists.sh")
    _make_specialist(tmp_path / ".claude-sdd" / "buddy" / "skills", "ancestor-spec")

    profile = tmp_path / "active-profile"
    _make_specialist(profile / "buddy" / "skills", "config-spec")

    r = _run(cwd=tmp_path, env={"CLAUDE_CONFIG_DIR": str(profile)},
             script=cache / "scripts" / "discover-specialists.sh")
    assert r.returncode == 0, r.stderr
    pairs = _scopes(r.stdout)
    assert ("global", "config-spec") in pairs
    assert ("global", "ancestor-spec") not in pairs


def test_claude_dir_mode_prints_resolved_profile(tmp_path):
    """`--claude-dir` prints the resolved active profile (for /buddy:create's
    global write target)."""
    profile = tmp_path / "profile"
    profile.mkdir()
    r = _run(cwd=tmp_path, env={"CLAUDE_CONFIG_DIR": str(profile)},
             args=["--claude-dir"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == str(profile)


def test_claude_dir_mode_empty_when_unresolvable(tmp_path):
    """`--claude-dir` prints nothing (not an error) when no profile resolves."""
    r = _run(cwd=tmp_path, args=["--claude-dir"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == ""
