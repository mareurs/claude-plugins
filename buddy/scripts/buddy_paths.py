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
