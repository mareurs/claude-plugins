"""Memory consolidation: candidate detection, plan parsing, and apply.

Phases:
  1. find_candidates(channel_root, specialist) -> dict (deterministic)
  2. (LLM) specialist emits a YAML plan against the candidate brief
  3. render_plan_for_user(plan_dict) -> markdown
  4. apply_plan(plan_dict, channel_root) -> ApplyResult
"""
from __future__ import annotations

from datetime import date
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


def find_candidates(
    channel_root: Path,
    specialist: str,
    *,
    summons_log_path: Path | None = None,
    stale_days: int = STALE_DAYS_DEFAULT,
) -> dict:
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
        if ARCHIVE_DIRNAME in path.parts:
            continue
        parsed = _parse_entry_safe(path)
        if parsed is None:
            orphans.append({"path": str(path), "reason": "missing-frontmatter"})
            continue
        entries.append(parsed)

    log_path = summons_log_path or _default_summons_log()
    grouped_slugs = {s for g in _slug_collision_groups(entries) for s in g["slugs"]}
    return {
        "specialist": specialist,
        "channel_root": str(channel_root),
        "slug_groups": _slug_collision_groups(entries),
        "tag_clusters": _tag_overlap_clusters([e for e in entries if e["slug"] not in grouped_slugs]),
        "stale": _stale_entries(entries, specialist, log_path, stale_days),
        "contradictions": _contradiction_pairs(entries),
        "orphans": orphans,
    }


def render_brief(cand: dict) -> str:
    """Render the candidate dict as a markdown brief for Phase 2."""
    lines = [
        f"# Consolidation Candidates — {cand['specialist']} in {cand['channel_root']}",
        "",
        f"## Slug-collision groups (N={len(cand['slug_groups'])})",
    ]
    for i, g in enumerate(cand["slug_groups"], 1):
        lines.append(f"- Group {i}: " + ", ".join(f"`{s}`" for s in g["slugs"]))
        for s, h in zip(g["slugs"], g["hooks"]):
            lines.append(f"  - `{s}`: {h}")
    lines.extend(["", f"## Tag-overlap clusters (N={len(cand['tag_clusters'])})"])
    for i, c in enumerate(cand["tag_clusters"], 1):
        tags = ", ".join(c["tags"])
        lines.append(f"- Cluster {i} (tags {{{tags}}}, {len(c['slugs'])} entries):")
        for s, h in zip(c["slugs"], c["hooks"]):
            lines.append(f"  - `{s}`: {h}")
    lines.extend(["", f"## Stale (N={len(cand['stale'])})"])
    for s in cand["stale"]:
        lines.append(f"- `{s['slug']}` — updated {s['updated']} ({s['days_stale']}d), no reload since")
    lines.extend(["", f"## Contradictions (N={len(cand['contradictions'])})"])
    for c in cand["contradictions"]:
        lines.append(f"- Pair: " + " vs ".join(f"`{s}`" for s in c["slugs"])
                     + f" — shared tags {c['shared_tags']}, negation in `{c['negation_in']}`")
    lines.extend(["", f"## Orphans (N={len(cand['orphans'])})"])
    for o in cand["orphans"]:
        from pathlib import Path
        lines.append(f"- `{Path(o['path']).name}` — {o['reason']}")
    return "\n".join(lines) + "\n"


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
    import re
    import yaml
    
    text = path.read_text()
    # Match YAML frontmatter: ---\n....\n---
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if not m:
        return None
    
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except Exception:
        return None
    
    # Also get hook from the body using memory module's logic
    from scripts.memory import _parse_entry
    out = _parse_entry(path)
    hook = out.get("hook", "") if out else ""
    
    # Convert date objects back to ISO strings
    updated = fm.get("updated", "") or ""
    created = fm.get("created", "") or ""
    if hasattr(updated, "isoformat"):
        updated = updated.isoformat()
    if hasattr(created, "isoformat"):
        created = created.isoformat()
    
    return {
        "path": str(path),
        "slug": fm.get("slug", path.stem),
        "tags": fm.get("tags", []) or [],
        "hook": hook or "",
        "updated": updated or "",
        "created": created or "",
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
    """Two-pass stemmer: (1) strip suffix (ation/tion/ing/es/s); (2) strip trailing weak vowel (u/a/e) if >4 chars. Together: 'eval'/'evaluation' both → 'eval'."""
    for suffix in ("ation", "tion", "ing", "es", "s"):
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            token = token[: -len(suffix)]
            break
    if token.endswith(("u", "a", "e")) and len(token) > 4:
        token = token[:-1]
    return token


def _kebab_token_overlap(a: list[str], b: list[str]) -> float:
    """Jaccard on kebab token sets (post-stemming). Identical → 1.0; disjoint → 0.0."""
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _tag_overlap_clusters(entries: list[dict]) -> list[dict]:
    """Group entries by shared-tag pairs (≥2 shared tags AND topically similar hook)."""
    from itertools import combinations
    by_tagpair: dict[frozenset[str], list[dict]] = {}
    for e in entries:
        tags = set(e["tags"])
        for pair in combinations(sorted(tags), 2):
            by_tagpair.setdefault(frozenset(pair), []).append(e)

    seen_slug_sets: set[frozenset[str]] = set()
    clusters: list[dict] = []
    for tagpair, members in by_tagpair.items():
        if len(members) < 2:
            continue
        
        # Union-find: connect entries with high hook similarity OR if group is big
        parent: dict[int] = {i: i for i in range(len(members))}
        
        def find(x):
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]
        
        def union(x, y):
            px, py = find(x), find(y)
            if px != py:
                parent[px] = py
        
        # Connect members with high hook similarity OR if we have 3+ members
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                if _hook_bigram_jaccard(members[i]["hook"], members[j]["hook"]) >= 0.4 or len(members) >= 3:
                    union(i, j)
        
        # Group by parent
        groups: dict[int, list[int]] = {}
        for i in range(len(members)):
            root = find(i)
            groups.setdefault(root, []).append(i)
        
        # Create clusters from groups with size >= 2
        for root, indices in groups.items():
            if len(indices) >= 2:
                bucket = [members[i] for i in indices]
                slug_set = frozenset(b["slug"] for b in bucket)
                if slug_set in seen_slug_sets:
                    continue
                seen_slug_sets.add(slug_set)
                clusters.append({
                    "tags": sorted(tagpair),
                    "slugs": sorted(b["slug"] for b in bucket),
                    "paths": [b["path"] for b in bucket],
                    "hooks": [b["hook"] for b in bucket],
                })
    
    return clusters


def _hook_bigram_jaccard(a: str, b: str) -> float:
    """Jaccard similarity over word-bigrams of two hook strings."""
    bg_a = _bigrams(a)
    bg_b = _bigrams(b)
    if not bg_a or not bg_b:
        return 0.0
    return len(bg_a & bg_b) / len(bg_a | bg_b)


def _bigrams(text: str) -> set[tuple[str, str]]:
    words = [w.lower() for w in text.split() if w.strip()]
    return {(words[i], words[i + 1]) for i in range(len(words) - 1)}



def _today_iso() -> str:
    """Wrapped for test monkeypatching."""
    return date.today().isoformat()


def _days_between(iso_a: str, iso_b: str) -> int:
    """Returns absolute day difference. Returns 0 if either parse fails."""
    try:
        da = date.fromisoformat(iso_a)
        db = date.fromisoformat(iso_b)
    except (ValueError, TypeError):
        return 0
    return abs((db - da).days)


def _summons_after(specialist: str, since_iso: str, log_path: Path) -> bool:
    """True if summons.log records the specialist being summoned after since_iso."""
    if not log_path.is_file():
        return False
    try:
        since_date = date.fromisoformat(since_iso)
        import calendar
        since_ts = calendar.timegm(since_date.timetuple())
    except ValueError:
        return False
    with log_path.open() as fh:
        for line in fh:
            parts = line.strip().split("\t")
            if len(parts) < 3:
                continue
            try:
                ts = int(parts[0])
            except ValueError:
                continue
            if parts[1] != specialist:
                continue
            if parts[2] == "summoned" and ts > since_ts:
                return True
    return False


def _stale_entries(
    entries: list[dict],
    specialist: str,
    summons_log_path: Path,
    stale_days: int,
) -> list[dict]:
    today = _today_iso()
    stale: list[dict] = []
    for e in entries:
        if not e.get("updated"):
            continue
        days_stale = _days_between(e["updated"], today)
        if days_stale < stale_days:
            continue
        loaded_since = _summons_after(specialist, e["updated"], summons_log_path)
        if loaded_since:
            continue
        stale.append({
            "slug": e["slug"],
            "path": e["path"],
            "updated": e["updated"],
            "days_stale": days_stale,
            "loaded_since": False,
        })
    return stale



NEGATION_TOKENS = {"don't", "dont", "never", "avoid", "not", "no", "stop"}


def _contradiction_pairs(entries: list[dict]) -> list[dict]:
    """Pairs that share ≥1 tag where exactly one entry's lesson contains a negation token."""
    pairs: list[dict] = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            a, b = entries[i], entries[j]
            shared = set(a["tags"]) & set(b["tags"])
            if not shared:
                continue
            neg_a = _has_negation(a["hook"])
            neg_b = _has_negation(b["hook"])
            if neg_a == neg_b:
                continue
            pairs.append({
                "slugs": sorted([a["slug"], b["slug"]]),
                "paths": [a["path"], b["path"]],
                "shared_tags": sorted(shared),
                "negation_in": a["slug"] if neg_a else b["slug"],
            })
    return pairs


def _has_negation(text: str) -> bool:
    words = [w.lower().strip(".,;:!?") for w in text.split()]
    return any(w in NEGATION_TOKENS for w in words)


def _default_summons_log() -> Path:
    return Path.home() / ".claude" / "buddy" / "summons.log"
