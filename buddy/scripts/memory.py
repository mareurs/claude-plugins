"""Buddy memory helper: INDEX regen, entry parsing, and channel metadata.

This module is intentionally small. The model drives memory routing,
slug choice, dedup, and write content via the prompts in
`commands/summon.md`, `commands/dismiss.md`, and `data/memory-protocol.md`.
This script only handles deterministic plumbing: parsing memory entries,
regenerating INDEX.md, and reading/writing channel metadata.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
_LESSON_RE = re.compile(r"^\*\*Lesson:\*\*\s*(.+?)$", re.MULTILINE)


def _parse_entry(path: Path) -> dict | None:
    text = path.read_text()
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return None
    fm_text, body = m.group(1), m.group(2).strip()
    fm: dict = {}
    for line in fm_text.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    specialist = fm.get("specialist", path.parent.name)
    slug = fm.get("slug", path.stem)
    lesson_m = _LESSON_RE.search(body)
    hook = lesson_m.group(1).strip() if lesson_m else (body[:80] if body else "")
    if not hook:
        hook = slug
    rel_path = f"{specialist}/{slug}.md"
    return {"specialist": specialist, "slug": slug, "hook": hook, "rel_path": rel_path}


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
                # Skip archived entries
                if any(part == ".archive" for part in entry_file.parts):
                    continue
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
    idx = Path(channel_root) / "INDEX.md"
    if not idx.is_file():
        return []
    out = []
    for line in idx.read_text().splitlines():
        m = _INDEX_LINE_RE.match(line)
        if m:
            out.append((m.group("key"), m.group("path"), m.group("hook")))
    return out


def read_channel_meta(channel_root: Path) -> dict:
    """Read <channel>/meta.json if present; return {} otherwise."""
    p = channel_root / "meta.json"
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def write_channel_meta(channel_root: Path, meta: dict) -> None:
    """Atomic-ish write of <channel>/meta.json."""
    p = channel_root / "meta.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, indent=2, sort_keys=True))
    tmp.replace(p)


def update_last_consolidated(channel_root: Path, specialist: str, iso: str) -> None:
    meta = read_channel_meta(channel_root)
    meta.setdefault("last_consolidated", {})[specialist] = iso
    write_channel_meta(channel_root, meta)
