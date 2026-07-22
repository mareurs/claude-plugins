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


def _sibling_repo_candidates(directory: str, plugin_root: Path) -> list[Path]:
    """Sister-plugin SKILL.md candidates for the flat dev/source-repo layout.

    In a dev install plugin_root points at the repo's plugin folder
    (`<repo>/buddy`) and sibling plugins live directly beside it
    (`<repo>/codescout-companion/skills/<directory>/SKILL.md`) with no
    intervening version directory. This complements _sister_plugin_candidates,
    which only matches the cached `<marketplace>/<plugin>/<ver>/` layout. The
    direct `<sibling>/skills/...` path never exists under the cache layout (it's
    `<sibling>/<ver>/skills/...`), so this fallback can't produce false matches
    there. Returns [] when no sibling ships the skill.
    """
    out: list[Path] = []
    try:
        repo_root = plugin_root.parent
        self_plugin_name = plugin_root.name
        siblings = list(repo_root.iterdir())
    except OSError:
        return []
    for sibling in siblings:
        try:
            if not sibling.is_dir() or sibling.name == self_plugin_name:
                continue
            cand = sibling / "skills" / directory / "SKILL.md"
            if cand.is_file():
                out.append(cand)
        except OSError:
            continue
    return out



def find_skill_md(
    directory: str,
    *,
    plugin_root: Path,
    project_root: Path,
) -> Path | None:
    """Locate SKILL.md for a specialist directory across 5 scopes.

    Precedence (highest first):
      1. project: <project_root>/.claude/buddy/skills/<directory>/SKILL.md
      2. global:  ${BUDDY_HOME:-~/.buddy}/skills/<directory>/SKILL.md
      3. builtin: <plugin_root>/skills/<directory>/SKILL.md
      4. sister:  <claude-dir>/plugins/cache/<marketplace>/<other-plugin>/<ver>/skills/<directory>/SKILL.md
      5. sibling: <repo>/<other-plugin>/skills/<directory>/SKILL.md  (flat dev/source layout)

    Sister scope (4) is derived from plugin_root's grandparent under the plugin
    cache layout. When plugin_root is `<claude-dir>/plugins/cache/<marketplace>/buddy/<ver>`,
    that grandparent is `<claude-dir>/plugins/cache/<marketplace>` and we iterate
    sibling plugins (codescout-companion, etc.) picking the newest cached version
    that ships `skills/<directory>/SKILL.md`. Sibling scope (5) covers the flat
    dev/source-repo layout where sibling plugins sit directly beside plugin_root
    with no version directory. This matters for cross-plugin specialists like
    `reconnaissance`, which ships in codescout-companion, not buddy.
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
    for c in _sibling_repo_candidates(directory, plugin_root):
        return c
    return None


def strip_frontmatter(text: str) -> str:
    """Drop a leading YAML frontmatter block (--- ... ---) from SKILL.md text.

    Frontmatter is loader metadata (name/description/inject bindings); the
    injected payload must start at the persona body. Returns text unchanged
    when no leading fence is present.
    """
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    rest = text[end + 4:]
    return rest.lstrip("\n")


def parse_frontmatter(text: str) -> dict:
    """Minimal frontmatter parser for the buddy-accepted subset.

    Flat `key: value` pairs only; a value shaped `[a, b]` parses as a list.
    This matches what edit_markdown's frontmatter tooling can write (flat
    keys, scalar/inline-array values). PyYAML is not a buddy dependency;
    anything outside this shape is silently ignored.
    """
    out: dict = {}
    if not text.startswith("---"):
        return out
    end = text.find("\n---", 3)
    if end == -1:
        return out
    for raw in text[3:end].splitlines():
        line = raw.strip()
        if not line or ":" not in line or raw.startswith((" ", "\t")):
            continue
        key, _, value = line.partition(":")
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            items = [v.strip().strip("'\"") for v in value[1:-1].split(",")]
            out[key.strip()] = [v for v in items if v]
        else:
            out[key.strip()] = value.strip("'\"")
    return out


def render_reload_block(
    specialists: list[str],
    *,
    new_sid: str,
    prev_sid: str,
    source: str,
    plugin_root: Path,
    project_root: Path,
) -> str:
    """Render the reload block injected into the new session's context.

    Returns empty string when there are no specialists to reload. Specialists
    whose SKILL.md cannot be located are silently skipped from BOTH the body
    and the arrival-line instruction — the model must never be told to
    announce an arrival for something it has no reloaded content for.
    """
    if not specialists:
        return ""

    bodies: list[str] = []
    included: list[str] = []
    for directory in specialists:
        skill = find_skill_md(
            directory,
            plugin_root=plugin_root,
            project_root=project_root,
        )
        if skill is None:
            continue
        try:
            content = strip_frontmatter(skill.read_text(encoding="utf-8"))
        except OSError:
            continue
        bodies.append(f"\n## {directory}\n{content}\n---")
        included.append(directory)

    if not included:
        return ""

    names = ", ".join(included)
    parts: list[str] = [
        f"<!-- buddy:reloaded sid={new_sid} from={prev_sid} source={source} -->",
        (
            f"Reloaded from {source} — and ONLY these, nothing else: {names}. "
            "Your FIRST user-facing line of this turn MUST be exactly one italic "
            "arrival line per name listed above, e.g. `*The Debugging Yeti arrives "
            f"— reloaded from {source}.*` Do not add an arrival line, mention, or "
            "persona banner for any other skill, specialist, or persona — even one "
            "named in the conversation summary above — since only the names listed "
            "here were actually restored to context."
        ),
    ]
    parts.extend(bodies)

    return "\n\n".join(parts)


def render_dismissal_notice(
    specialists: list[str],
    *,
    new_sid: str,
    prev_sid: str,
    source: str,
) -> str:
    """Render the notice shown when specialists are released at compaction.

    Unlike render_reload_block, this injects NO SKILL.md bodies. Compaction
    summarizes history, so the verbatim personas are gone from context; rather
    than auto-re-injecting them (re-bloat), buddy releases them and lets the
    user re-summon the ones they still want. Lists the released specialists by
    slug so they map directly onto `/buddy:summon <name>`. Returns "" for an
    empty list.
    """
    if not specialists:
        return ""
    names = ", ".join(specialists)
    return (
        f"<!-- buddy:dismissed-on-compact sid={new_sid} from={prev_sid} source={source} -->\n"
        "The session compacted, so the specialists summoned earlier were released — "
        "their full personas are no longer in context. Begin this turn by telling the "
        "user, in one line, that the following were released and can be re-summoned with "
        f"`/buddy:summon <name>` if still needed: {names}."
    )
