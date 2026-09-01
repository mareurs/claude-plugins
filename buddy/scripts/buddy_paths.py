"""Resolved filesystem locations for buddy's profile-agnostic global state.

All global buddy state (specialists, memories, summons log, identity) lives
under a single home shared by every CC instance — default ~/.buddy, overridable
via $BUDDY_HOME. This module is the single source of truth for those paths so
no caller hardcodes a per-profile `~/.claude*/buddy` location.
"""
from __future__ import annotations

import os
from pathlib import Path


def global_root() -> Path:
    env = os.environ.get("BUDDY_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".buddy"


def global_skills() -> Path:
    return global_root() / "skills"


def global_memory() -> Path:
    return global_root() / "memory"


def summons_log() -> Path:
    return global_root() / "summons.log"


def identity_path() -> Path:
    return global_root() / "identity.json"


def resolve_project_root(cwd: "str | os.PathLike | None") -> Path:
    """Resolve a session cwd upward to the nearest enclosing project root.

    **A cwd is not a project root.** Buddy's per-session directory used to be
    built as `Path(event["cwd"]) / ".buddy" / <sid>`, so a session started in a
    subdirectory planted its state there — observed live as
    `codescout/docs/issues/.buddy/<sid>/` being written at the same time as the
    same session's canonical `codescout/.buddy/<sid>/`. One session, state split
    across two directories, and every consumer that derived a project root back
    out of it resolved against the subdirectory.

    Two consequences, both silent: a nested `.buddy/` is untracked rather than
    ignored (`.gitignore` is root-anchored `/.buddy/*`), so a peer's `git add -A`
    commits another session's tool log; and the judge's plan read and constraints
    read are both `exists()`-guarded, so a wrong root degrades it to no plan and
    no constraints without raising.

    Keeping `event["cwd"]` as the per-session *source* is correct — the
    alternative, `state.signals.root_cwd`, is a shared global that concurrent
    sessions overwrite. The defect was one layer up: using it as a root without
    resolving it to one. This is that resolution, in one place, because there are
    at least three cwd-relative planters across two plugins and correcting them
    separately is how they drift.

    Markers, nearest ancestor wins: `.git` (a *file* in a linked worktree, hence
    `exists()` not `is_dir()`) or `.codescout/project.toml`. Falls back to the
    starting directory when neither is found anywhere above — documented, so a
    non-repo cwd behaves exactly as it did before.

    See docs/issues/2026-08-31-buddy-session-dir-treats-cwd-as-project-root.md
    """
    start = Path(cwd) if cwd else Path(os.getcwd())
    try:
        start = start.resolve()
    except OSError:
        return start
    for cand in (start, *start.parents):
        if (cand / ".git").exists():
            return cand
        if (cand / ".codescout" / "project.toml").is_file():
            return cand
    return start
