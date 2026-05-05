"""Buddy memory helper: instance discovery, mirror writes, INDEX regen.

This module is intentionally small. The model drives memory routing,
slug choice, dedup, and write content via the prompts in
`commands/summon.md`, `commands/dismiss.md`, and `data/memory-protocol.md`.
This script only handles deterministic plumbing: locating CC instance
dirs and copying global memories between them.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
INSTANCES_REGISTRY = PLUGIN_ROOT / "data" / "instances.json"


def _load_registry() -> list[Path]:
    if not INSTANCES_REGISTRY.exists():
        return []
    raw = json.loads(INSTANCES_REGISTRY.read_text())
    return [Path(os.path.expanduser(p)) for p in raw.get("instances", [])]


def current_instance_dir() -> Path | None:
    """Return the CC instance dir that owns this plugin install."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not plugin_root:
        return None
    p = Path(plugin_root).resolve()
    for parent in [p, *p.parents]:
        if parent.name in {".claude", ".claude-sdd"}:
            return parent
        if (parent / "plugins").is_dir():
            return parent
    return None


def other_instance_dirs() -> list[Path]:
    """Registered instance dirs that are not the current one and exist on disk."""
    cur = current_instance_dir()
    out: list[Path] = []
    for inst in _load_registry():
        if cur and inst.resolve() == cur.resolve():
            continue
        if inst.is_dir():
            out.append(inst)
    return out
