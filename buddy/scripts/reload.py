"""Specialist reload — SKILL.md discovery + reload context block.

Used by SessionStart hook on source ∈ {resume, compact}: locates each
prior-segment specialist's SKILL.md across the 3-scope precedence
(project → global → builtin) and renders a reload block that Claude Code
appends to the new session's context.

Silent on failure — reload is advisory, never breaks user flow.
"""
from __future__ import annotations

from pathlib import Path


def find_skill_md(
    directory: str,
    *,
    plugin_root: Path,
    project_root: Path,
    home: Path,
) -> Path | None:
    """Locate SKILL.md for a specialist directory across 3 scopes.

    Precedence (highest first):
      1. project: <project_root>/.claude/buddy/skills/<directory>/SKILL.md
      2. global:  <home>/.claude/buddy/skills/<directory>/SKILL.md
      3. builtin: <plugin_root>/skills/<directory>/SKILL.md
    """
    candidates = [
        project_root / ".claude" / "buddy" / "skills" / directory / "SKILL.md",
        home / ".claude" / "buddy" / "skills" / directory / "SKILL.md",
        plugin_root / "skills" / directory / "SKILL.md",
    ]
    for c in candidates:
        try:
            if c.is_file():
                return c
        except OSError:
            continue
    return None


def render_reload_block(
    specialists: list[str],
    *,
    new_sid: str,
    prev_sid: str,
    source: str,
    plugin_root: Path,
    project_root: Path,
    home: Path,
) -> str:
    """Render the reload block injected into the new session's context.

    Returns empty string when there are no specialists to reload. Specialists
    whose SKILL.md cannot be located are silently skipped.
    """
    if not specialists:
        return ""

    parts: list[str] = []
    parts.append(
        f"<!-- buddy:reloaded sid={new_sid} from={prev_sid} source={source} -->"
    )
    parts.append(
        "The following specialists were summoned in the prior segment. "
        f"Reload them now (source: {source}). "
        "Your FIRST user-facing line of this turn MUST be one italic arrival "
        "line per specialist, e.g. `*The Debugging Yeti arrives — reloaded from "
        f"{source}.*`"
    )

    body_count = 0
    for directory in specialists:
        skill = find_skill_md(
            directory,
            plugin_root=plugin_root,
            project_root=project_root,
            home=home,
        )
        if skill is None:
            continue
        try:
            content = skill.read_text(encoding="utf-8")
        except OSError:
            continue
        parts.append(f"\n## {directory}\n{content}\n---")
        body_count += 1

    if body_count == 0:
        return ""

    return "\n\n".join(parts)
