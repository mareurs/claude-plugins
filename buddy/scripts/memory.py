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
import re
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


def mirror_global_write(rel_path: Path | str) -> list[Path]:
    """Copy a memory file from the current instance's global memory dir to
    every other registered instance. Returns list of paths written.

    `rel_path` is relative to `<instance>/buddy/memory/`, e.g.
    `Path("debugging-yeti/flaky-tests.md")`.
    """
    rel = Path(rel_path)
    cur = current_instance_dir()
    if cur is None:
        return []
    src = cur / "buddy" / "memory" / rel
    if not src.is_file():
        return []
    written: list[Path] = []
    for other in other_instance_dirs():
        dst = other / "buddy" / "memory" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        written.append(dst)
    return written


_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
_LESSON_RE = re.compile(r"^\*\*Lesson:\*\*\s*(.+?)$", re.MULTILINE)


def _parse_entry(path: Path) -> dict | None:
    text = path.read_text()
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return None
    fm_raw, body = m.group(1), m.group(2)
    fm: dict[str, str] = {}
    for line in fm_raw.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    slug = fm.get("slug") or path.stem
    specialist = fm.get("specialist") or path.parent.name
    lm = _LESSON_RE.search(body)
    lines = body.strip().splitlines()
    hook = lm.group(1).strip() if lm else (lines[0][:120] if lines else "")
    return {
        "specialist": specialist,
        "slug": slug,
        "rel_path": f"{specialist}/{slug}.md",
        "hook": hook,
    }


def regen_index(channel_root: Path) -> Path:
    """Walk `<channel_root>/<specialist>/*.md` and `<channel_root>/common/*.md`,
    write a fresh INDEX.md.
    """
    channel_root = Path(channel_root)
    entries: list[dict] = []
    if channel_root.is_dir():
        for spec_dir in sorted(channel_root.iterdir()):
            if not spec_dir.is_dir():
                continue
            for entry_file in sorted(spec_dir.glob("*.md")):
                parsed = _parse_entry(entry_file)
                if parsed:
                    entries.append(parsed)
    lines = [
        f"- [{e['specialist']}/{e['slug']}]({e['rel_path']}) — {e['hook']}"
        for e in entries
    ]
    idx_path = channel_root / "INDEX.md"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text("\n".join(lines) + ("\n" if lines else ""))
    return idx_path


_INDEX_LINE_RE = re.compile(r"^- \[(?P<key>[^\]]+)\]\((?P<path>[^)]+)\) — (?P<hook>.+)$")


def read_index(channel_root: Path) -> list[tuple[str, str, str]]:
    """Return `[(key, rel_path, hook), ...]` for every line in INDEX.md.
    Returns `[]` if INDEX.md is missing.
    """
    idx = Path(channel_root) / "INDEX.md"
    if not idx.is_file():
        return []
    out: list[tuple[str, str, str]] = []
    for line in idx.read_text().splitlines():
        m = _INDEX_LINE_RE.match(line)
        if m:
            out.append((m.group("key"), m.group("path"), m.group("hook")))
    return out
