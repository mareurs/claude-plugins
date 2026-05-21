"""Tests for discover-specialists.sh — three-scope specialist discovery."""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "discover-specialists.sh"


def _run(*, cwd=None, env=None, script=None, args=()):
    e = os.environ.copy()
    # Strip inherited profile/project signals so each test controls them.
    e.pop("CLAUDE_CONFIG_DIR", None)
    e.pop("CLAUDE_PROJECT_DIR", None)
    e.pop("CLAUDE_PLUGIN_ROOT", None)
    e.pop("BUDDY_HOME", None)
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


def test_project_scope_via_claude_project_dir(tmp_path):
    proj = tmp_path / "proj"
    _make_specialist(proj / ".buddy" / "skills", "proj-only-spec")
    r = _run(cwd=tmp_path, env={"CLAUDE_PROJECT_DIR": str(proj)})
    assert r.returncode == 0, r.stderr
    assert ("project", "proj-only-spec") in _scopes(r.stdout)


def test_global_scope_via_buddy_home(tmp_path):
    """Global specialists resolve from $BUDDY_HOME/skills, no profile logic."""
    bhome = tmp_path / "buddyhome"
    _make_specialist(bhome / "skills", "codescout-pika")
    r = _run(cwd=tmp_path, env={"BUDDY_HOME": str(bhome)})
    assert r.returncode == 0, r.stderr
    assert ("global", "codescout-pika") in _scopes(r.stdout)


def test_default_global_root_is_home_dot_buddy(tmp_path):
    """With no BUDDY_HOME, global scope is $HOME/.buddy/skills."""
    _make_specialist(tmp_path / ".buddy" / "skills", "home-spec")
    r = _run(cwd=tmp_path, env={"HOME": str(tmp_path)})
    assert r.returncode == 0, r.stderr
    assert ("global", "home-spec") in _scopes(r.stdout)


def test_no_buddy_home_dir_is_silent(tmp_path):
    r = _run(cwd=tmp_path, env={"HOME": str(tmp_path)})
    assert r.returncode == 0, r.stderr
    assert not any(scope == "global" for scope, _ in _scopes(r.stdout))
