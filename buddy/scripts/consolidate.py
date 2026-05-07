"""Memory consolidation: candidate detection, plan parsing, and apply.

Phases:
  1. find_candidates(channel_root, specialist) -> dict (deterministic)
  2. (LLM) specialist emits a YAML plan against the candidate brief
  3. render_plan_for_user(plan_dict) -> markdown
  4. apply_plan(plan_dict, channel_root) -> ApplyResult
"""
from __future__ import annotations

from pathlib import Path

CHANNEL_LOCK_NAME = ".consolidation.lock"
CHANNEL_LOG_NAME = ".consolidation.log"
CHANNEL_PLAN_NAME = ".consolidation-plan.md"
CHANNEL_DEFERRED_NAME = ".deferred.md"
CHANNEL_META_NAME = "meta.json"
ARCHIVE_DIRNAME = ".archive"

STALE_DAYS_DEFAULT = 90
SOFT_CAP_ENTRIES = 30
STALE_DAYS_NUDGE = 30
PLAN_TTL_HOURS = 24


def find_candidates(channel_root: Path, specialist: str) -> dict:
    """Phase 1 — deterministic candidate detection. Pure function, no LLM call."""
    spec_dir = channel_root / specialist
    if not spec_dir.is_dir():
        return _empty_candidates(specialist, channel_root)

    entries = []
    orphans = []
    for path in sorted(spec_dir.iterdir()):
        if not path.is_file() or path.suffix != ".md":
            continue
        if path.name.startswith("."):
            continue
        parsed = _parse_entry_safe(path)
        if parsed is None:
            orphans.append({"path": str(path), "reason": "missing-frontmatter"})
            continue
        entries.append(parsed)

    return {
        "specialist": specialist,
        "channel_root": str(channel_root),
        "slug_groups": _slug_collision_groups(entries),
        "tag_clusters": [],
        "stale": [],
        "contradictions": [],
        "orphans": orphans,
    }


def render_brief(candidates: dict) -> str:
    """Render the candidate dict as a markdown brief for Phase 2."""
    raise NotImplementedError("filled in by Task 6")


def parse_plan(text: str) -> dict:
    """Parse the YAML plan emitted by the specialist. Raises ValueError on malformed input."""
    raise NotImplementedError("filled in by Task 8")


def render_plan_for_user(plan: dict) -> str:
    """Render parsed plan as the dry-run markdown shown to the user."""
    raise NotImplementedError("filled in by Task 12")


def apply_plan(plan: dict, channel_root: Path) -> dict:
    """Phase 4 — file moves driven by the plan. Idempotent."""
    raise NotImplementedError("filled in by Tasks 9–11, 13")


def _empty_candidates(specialist: str, channel_root: Path) -> dict:
    return {
        "specialist": specialist,
        "channel_root": str(channel_root),
        "slug_groups": [],
        "tag_clusters": [],
        "stale": [],
        "contradictions": [],
        "orphans": [],
    }


def _parse_entry_safe(path: Path) -> dict | None:
    """Parse a memory entry; return None on malformed frontmatter."""
    from buddy.scripts.memory import _parse_entry  # type: ignore
    out = _parse_entry(path)
    if out is None:
        return None
    return {
        "path": str(path),
        "slug": out.get("slug", path.stem),
        "tags": out.get("tags", []) or [],
        "hook": out.get("hook", "") or "",
        "updated": out.get("updated", "") or "",
        "created": out.get("created", "") or "",
    }


def _slug_collision_groups(entries: list[dict]) -> list[dict]:
    """Group entries by ≥0.85 kebab-token overlap on slug."""
    groups: list[dict] = []
    used: set[int] = set()
    for i, e in enumerate(entries):
        if i in used:
            continue
        bucket = [e]
        bucket_idx = [i]
        ti = _kebab_tokens(e["slug"])
        for j in range(i + 1, len(entries)):
            if j in used:
                continue
            tj = _kebab_tokens(entries[j]["slug"])
            if _kebab_token_overlap(ti, tj) >= 0.85:
                bucket.append(entries[j])
                bucket_idx.append(j)
        if len(bucket) >= 2:
            for k in bucket_idx:
                used.add(k)
            groups.append({
                "slugs": [b["slug"] for b in bucket],
                "paths": [b["path"] for b in bucket],
                "hooks": [b["hook"] for b in bucket],
            })
    return groups


def _kebab_tokens(slug: str) -> list[str]:
    """Tokens of a kebab slug, lowercased, with simple stem normalization."""
    raw = [t for t in slug.lower().split("-") if t]
    return [_stem(t) for t in raw]


def _stem(token: str) -> str:
    """Crude stemmer: drop trailing 'tion'/'ing'/'s' so 'eval'/'evaluation' converge."""
    # First, strip longest suffix
    for suffix in ("ation", "tion", "ing", "es", "s"):
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            token = token[: -len(suffix)]
            break
    # Then strip remaining vowel-heavy ending if still long enough
    # e.g., "evalu" -> "eval"
    if token.endswith(("u", "a", "e")) and len(token) > 4:
        token = token[:-1]
    return token


def _kebab_token_overlap(a: list[str], b: list[str]) -> float:
    """Jaccard on kebab token sets (post-stemming). Identical → 1.0; disjoint → 0.0."""
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)
