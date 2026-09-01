"""Tests for buddy_paths — resolved global-state locations."""
from pathlib import Path

from scripts import buddy_paths


def test_default_root_is_home_dot_buddy(monkeypatch, tmp_path):
    monkeypatch.delenv("BUDDY_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert buddy_paths.global_root() == tmp_path / ".buddy"


def test_buddy_home_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "custom"))
    assert buddy_paths.global_root() == tmp_path / "custom"


def test_buddy_home_expands_user(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BUDDY_HOME", "~/elsewhere")
    assert buddy_paths.global_root() == tmp_path / "elsewhere"


def test_accessors_compose_on_root(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "b"))
    root = tmp_path / "b"
    assert buddy_paths.global_skills() == root / "skills"
    assert buddy_paths.global_memory() == root / "memory"
    assert buddy_paths.summons_log() == root / "summons.log"
    assert buddy_paths.identity_path() == root / "identity.json"


# --- resolve_project_root: a cwd is not a project root -----------------------
# docs/issues/archive/2026-08-31-buddy-session-dir-treats-cwd-as-project-root.md

def test_resolve_project_root_walks_up_to_the_git_marker(tmp_path):
    """A session started in a subdirectory must resolve to the repo root.

    The assertion names the EXPECTED ABSOLUTE root rather than re-deriving it
    from the result — re-deriving (e.g. `result.parent.parent`) passes in the
    broken world by construction, which is how the original `.buddy/<sid> →
    project` derivation at hook_helpers.py:637 stayed wrong.
    """
    from scripts.buddy_paths import resolve_project_root

    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    deep = repo / "docs" / "issues"
    deep.mkdir(parents=True)

    assert resolve_project_root(deep) == repo.resolve()
    assert resolve_project_root(repo) == repo.resolve()


def test_resolve_project_root_accepts_a_gitfile_worktree(tmp_path):
    """In a linked worktree `.git` is a FILE, so the marker test cannot be is_dir()."""
    from scripts.buddy_paths import resolve_project_root

    wt = tmp_path / "wt"
    sub = wt / "src" / "deep"
    sub.mkdir(parents=True)
    (wt / ".git").write_text("gitdir: /elsewhere/.git/worktrees/wt\n", encoding="utf-8")

    assert resolve_project_root(sub) == wt.resolve()


def test_resolve_project_root_accepts_codescout_project_toml(tmp_path):
    from scripts.buddy_paths import resolve_project_root

    proj = tmp_path / "proj"
    (proj / ".codescout").mkdir(parents=True)
    (proj / ".codescout" / "project.toml").write_text("[project]\n", encoding="utf-8")
    sub = proj / "a" / "b"
    sub.mkdir(parents=True)

    assert resolve_project_root(sub) == proj.resolve()


def test_resolve_project_root_falls_back_to_cwd_when_unmarked(tmp_path):
    """Documented fallback: a non-repo cwd behaves exactly as it did before."""
    from scripts.buddy_paths import resolve_project_root

    bare = tmp_path / "nowhere" / "deep"
    bare.mkdir(parents=True)
    assert resolve_project_root(bare) == bare.resolve()


def test_resolve_project_root_prefers_the_nearest_marker(tmp_path):
    """A nested project inside an outer repo resolves to the INNER one."""
    from scripts.buddy_paths import resolve_project_root

    outer = tmp_path / "outer"
    (outer / ".git").mkdir(parents=True)
    inner = outer / "vendor" / "inner"
    (inner / ".git").mkdir(parents=True)
    sub = inner / "src"
    sub.mkdir(parents=True)

    assert resolve_project_root(sub) == inner.resolve()


def test_hook_entry_project_root_resolves_a_subdirectory_cwd(tmp_path):
    """The hook choke point must resolve, not pass cwd through verbatim.

    hook_entry._project_root feeds every `.buddy/<sid>` and `by-ppid` path in
    buddy's hook lanes, so a cwd passed through unresolved is what planted
    `<repo>/docs/issues/.buddy/<sid>/` in the live reproduction.
    """
    from scripts.hook_entry import _project_root

    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    deep = repo / "docs" / "issues"
    deep.mkdir(parents=True)

    assert _project_root({"cwd": str(deep)}) == repo.resolve()


def test_session_dir_is_planted_at_the_repo_root_not_the_cwd(tmp_path):
    """End to end: a subdirectory session must not plant .buddy beside itself."""
    from scripts.hook_helpers import handle_session_start

    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    deep = repo / "docs" / "issues"
    deep.mkdir(parents=True)
    sid = "sub-dir-sid"

    handle_session_start(
        {"timestamp": 1700000000, "session_id": sid, "source": "startup",
         "cwd": str(deep)},
        path=repo / ".buddy" / sid / "state.json",
    )

    assert not (deep / ".buddy").exists(), \
        f"planted a stray .buddy in the subdirectory: {list(deep.iterdir())}"
