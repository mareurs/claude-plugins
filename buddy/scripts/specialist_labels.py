"""Resolve specialist slug → plain label (e.g. 'debugging-yeti' → 'Debugging Yeti').

Reads YAML frontmatter `name:` field from SKILL.md across 3 scopes
(project → global → builtin), matching reload.find_skill_md precedence.

Falls back to a humanized slug when frontmatter is missing or the file
cannot be located. Silent on errors.
"""
from __future__ import annotations

from pathlib import Path

from scripts.reload import find_skill_md


def _parse_frontmatter_name(path: Path) -> str | None:
    """Try YAML frontmatter `name:` first, then first H1 (minus leading 'The ')."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].splitlines():
                line = line.strip()
                if line.startswith("name:"):
                    value = line[5:].strip().strip("'\"")
                    if value:
                        return value
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            if title.lower().startswith("the "):
                title = title[4:].strip()
            return title or None
    return None


def _humanize(slug: str) -> str:
    return " ".join(word.capitalize() for word in slug.split("-"))


def resolve_label(
    directory: str,
    *,
    plugin_root: Path,
    project_root: Path,
) -> str:
    """Return a plain label for a specialist directory.

    Precedence: SKILL.md frontmatter `name:` → humanized slug.
    """
    skill = find_skill_md(
        directory,
        plugin_root=plugin_root,
        project_root=project_root,
    )
    if skill is not None:
        name = _parse_frontmatter_name(skill)
        if name:
            # Agent Skills spec names are lowercase-hyphenated identifiers; humanize
            # them for the statusline label ("debugging-yeti" → "Debugging Yeti").
            # A legacy Title-cased name is already display-ready — keep it as-is.
            return _humanize(name) if name == name.lower() else name
    return _humanize(directory)


def resolve_labels(
    directories: list[str],
    *,
    plugin_root: Path,
    project_root: Path,
) -> list[tuple[str, str]]:
    """Resolve a list of slugs into (slug, label) pairs preserving order."""
    out = []
    for d in directories:
        out.append((d, resolve_label(
            d, plugin_root=plugin_root, project_root=project_root,
        )))
    return out
