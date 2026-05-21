"""Specialist reload — SKILL.md discovery + reload context block.

Used by SessionStart hook on source ∈ {resume, compact}: locates each
prior-segment specialist's SKILL.md across the 3-scope precedence
(project → global → builtin) and renders a reload block that Claude Code
appends to the new session's context.

Silent on failure — reload is advisory, never breaks user flow.
"""
from __future__ import annotations

from pathlib import Path

from scripts import buddy_paths


def _semver_key(name: str) -> tuple:
    """Sort key for cached version directories. Numeric tuple per dot-segment;
    falls back to (-1, name) for non-semver names so they sort before real
    versions. '1.11.0' must beat '1.9.9' which lex sort gets wrong."""
    parts = name.split(".")
    out: list[int] = []
    for p in parts:
        try:
            out.append(int(p))
        except ValueError:
            return (-1, name)
    return (0, tuple(out))


def _sister_plugin_candidates(directory: str, plugin_root: Path) -> list[Path]:
    """Sister-plugin SKILL.md candidates derived from the plugin cache layout.

    When plugin_root looks like `<claude-dir>/plugins/cache/<marketplace>/buddy/<ver>`,
    its grandparent (`<claude-dir>/plugins/cache/<marketplace>`) holds sibling
    plugins (codescout-companion, etc.). For each sibling, return the highest
    cached version's `skills/<directory>/SKILL.md`. Returns [] when plugin_root
    does not match the cache pattern (e.g. dev mode where plugin_root points
    at the repo itself).
    """
    try:
        marketplace_root = plugin_root.parent.parent
        if not marketplace_root.is_dir():
            return []
        if "cache" not in marketplace_root.parts:
            return []
    except (OSError, IndexError):
        return []

    out: list[Path] = []
    self_plugin_name = plugin_root.parent.name
    try:
        siblings = list(marketplace_root.iterdir())
    except OSError:
        return []
    for sibling in siblings:
        if not sibling.is_dir():
            continue
        if sibling.name == self_plugin_name:
            continue
        try:
            versions = sorted(
                (v for v in sibling.iterdir() if v.is_dir()),
                key=lambda p: _semver_key(p.name),
                reverse=True,
            )
        except OSError:
            continue
        for v in versions:
            cand = v / "skills" / directory / "SKILL.md"
            if cand.is_file():
                out.append(cand)
                break
    return out



def find_skill_md(
    directory: str,
    *,
    plugin_root: Path,
    project_root: Path,
    home: Path,
) -> Path | None:
    """Locate SKILL.md for a specialist directory across 4 scopes.

    Precedence (highest first):
      1. project: <project_root>/.claude/buddy/skills/<directory>/SKILL.md
      2. global:  ${BUDDY_HOME:-~/.buddy}/skills/<directory>/SKILL.md
      3. builtin: <plugin_root>/skills/<directory>/SKILL.md
      4. sister:  <claude-dir>/plugins/cache/<marketplace>/<other-plugin>/<ver>/skills/<directory>/SKILL.md

    Sister scope is derived from plugin_root's grandparent. When plugin_root
    is `<claude-dir>/plugins/cache/<marketplace>/buddy/<ver>`, that grandparent
    is `<claude-dir>/plugins/cache/<marketplace>` and we iterate sibling
    plugins (codescout-companion, etc.) picking the newest cached version
    that ships `skills/<directory>/SKILL.md`. Returns None on dev installs
    where plugin_root does not match the cache layout.
    """
    candidates = [
        project_root / ".claude" / "buddy" / "skills" / directory / "SKILL.md",
        buddy_paths.global_skills() / directory / "SKILL.md",
        plugin_root / "skills" / directory / "SKILL.md",
    ]
    for c in candidates:
        try:
            if c.is_file():
                return c
        except OSError:
            continue
    for c in _sister_plugin_candidates(directory, plugin_root):
        return c
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
