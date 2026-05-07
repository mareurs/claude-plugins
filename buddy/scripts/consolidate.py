"""Memory consolidation: candidate detection, plan parsing, and apply.

Phases:
  1. find_candidates(channel_root, specialist) -> dict (deterministic)
  2. (LLM) specialist emits a YAML plan against the candidate brief
  3. render_plan_for_user(plan_dict) -> markdown
  4. apply_plan(plan_dict, channel_root) -> ApplyResult
"""
from __future__ import annotations

import re
import shutil
from datetime import date, datetime
from pathlib import Path

import yaml

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
        lines.append(f"- `{Path(o['path']).name}` — {o['reason']}")
    return "\n".join(lines) + "\n"



_FENCE_RE = re.compile(r"```yaml\s*\n(.*?)\n```", re.DOTALL)
_VALID_OPS = {"merge", "archive", "summarize", "keep_all", "defer"}


def _extract_yaml(text: str) -> str:
    """Extract YAML payload from fenced block or return raw text if it contains plan keys."""
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1)
    if "plan_version" in text and "operations" in text:
        return text
    raise ValueError("no plan: response contains no fenced yaml block and no plan keys")


def _validate_plan(data: dict) -> None:
    """Validate plan structure and operation requirements."""
    if data.get("plan_version") != 1:
        raise ValueError(f"unsupported plan_version: {data.get('plan_version')!r}")
    if not isinstance(data.get("operations"), list):
        raise ValueError("operations: must be a list")
    for i, op in enumerate(data["operations"]):
        if not isinstance(op, dict):
            raise ValueError(f"operations[{i}] not a mapping")
        kind = op.get("op")
        if kind not in _VALID_OPS:
            raise ValueError(f"operations[{i}].op {kind!r} not in {sorted(_VALID_OPS)}")
        if kind in ("merge", "summarize"):
            if not isinstance(op.get("inputs"), list) or not op["inputs"]:
                raise ValueError(f"operations[{i}] ({kind}) requires non-empty inputs list")
            if not isinstance(op.get("output"), dict):
                raise ValueError(f"operations[{i}] ({kind}) requires output mapping")
            if not op["output"].get("slug"):
                raise ValueError(f"operations[{i}] ({kind}).output.slug missing")
        if kind == "archive":
            if not op.get("slug"):
                raise ValueError(f"operations[{i}] (archive).slug missing")
        if kind == "keep_all":
            if not isinstance(op.get("slugs"), list):
                raise ValueError(f"operations[{i}] (keep_all).slugs missing")
        if kind == "defer":
            if not op.get("target"):
                raise ValueError(f"operations[{i}] (defer).target missing")


def parse_plan(text: str) -> dict:
    """Parse the YAML plan emitted by the specialist. Raises ValueError on malformed input."""
    payload = _extract_yaml(text)
    try:
        data = yaml.safe_load(payload)
    except yaml.YAMLError as exc:
        raise ValueError(f"plan YAML failed to parse: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("plan must be a YAML mapping at the top level")
    _validate_plan(data)
    return data


def render_plan_for_user(plan: dict) -> str:
    """Render parsed plan as the dry-run markdown shown to the user."""
    by_kind: dict[str, list] = {"merge": [], "archive": [], "summarize": [], "keep_all": [], "defer": []}
    for op in plan["operations"]:
        by_kind[op["op"]].append(op)

    lines = [
        f"# Consolidation plan — {plan['specialist']} in {plan['channel']}",
        f"# Generated {plan['generated']}, by {plan['specialist']}",
        "",
        f"## Merges ({len(by_kind['merge'])})",
    ]
    for op in by_kind["merge"]:
        lines.append(f"▸ Merge `{'`, `'.join(op['inputs'])}` → `{op['output']['slug']}`")
        lines.append(f"  Reason: {op['reason']}")
        lines.append(f"  New body:")
        for body_line in op["output"].get("body", "").splitlines():
            lines.append(f"    {body_line}")
    lines.extend(["", f"## Archives ({len(by_kind['archive'])})"])
    for op in by_kind["archive"]:
        lines.append(f"▸ Archive `{op['slug']}`")
        lines.append(f"  Reason: {op['reason']}")
    lines.extend(["", f"## Summaries ({len(by_kind['summarize'])})"])
    for op in by_kind["summarize"]:
        lines.append(f"▸ Summarize {{ {len(op['inputs'])} entries }} → `{op['output']['slug']}`")
        lines.append(f"  Reason: {op['reason']}")
        lines.append(f"  Originals (will be archived): {', '.join(op['inputs'])}")
    lines.extend(["", f"## Deferred ({len(by_kind['defer'])})"])
    for op in by_kind["defer"]:
        lines.append(f"▸ Defer `{op['target']}`")
        lines.append(f"  Reason: {op['reason']}")
    n_ops = sum(len(v) for v in by_kind.values())
    lines.extend(["", "## Summary", f"  {n_ops} ops, {len(by_kind['defer'])} deferred for your decision."])
    return "\n".join(lines) + "\n"


def apply_plan(plan: dict, channel_root: Path, *, today: str | None = None) -> dict:
    """Phase 4 — file moves driven by the plan. Idempotent, fail-closed.

    Returns: {"applied": int, "skipped": int, "deferred": list[str], "log": list[str]}
    """
    today = today or _today_iso()
    specialist = plan["specialist"]
    if not _is_safe_path_component(specialist):
        raise ValueError(f"path: specialist {specialist!r} is not a safe path component")
    for op in plan["operations"]:
        for slug in _slugs_in_op(op):
            if not _is_safe_path_component(slug):
                raise ValueError(f"path: slug {slug!r} is not a safe path component")
    spec_dir = channel_root / specialist
    spec_dir.mkdir(parents=True, exist_ok=True)
    log: list[str] = []
    deferred: list[str] = []
    applied = 0
    skipped = 0

    for op in plan["operations"]:
        kind = op["op"]
        try:
            if kind in ("merge", "summarize"):
                _apply_merge_like(op, spec_dir, channel_root, specialist, today, log)
                applied += 1
            elif kind == "archive":
                _apply_archive(op, channel_root, specialist, today, log)
                applied += 1
            elif kind == "keep_all":
                log.append(f"{today} keep_all {specialist} {op.get('slugs', [])}")
                applied += 1
            elif kind == "defer":
                deferred.append(str(op.get("target", "")))
                _append_deferred(channel_root, op, today)
                log.append(f"{today} defer {specialist} {op.get('target', '')}")
                applied += 1
        except FileNotFoundError as exc:
            log.append(f"{today} skip {kind} {specialist}: {exc}")
            skipped += 1

    # Append per-op log lines.
    log_path = channel_root / CHANNEL_LOG_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a") as fh:
        for line in log:
            fh.write(line + "\n")

    # Update last_consolidated in meta.json.
    from scripts.memory import update_last_consolidated, regen_index
    update_last_consolidated(channel_root, specialist, today + "T00:00:00Z")

    # Regen INDEX.
    try:
        regen_index(channel_root)
    except Exception:
        pass  # INDEX is advisory; never block apply

    # Delete cached plan if present.
    plan_cache = channel_root / CHANNEL_PLAN_NAME
    if plan_cache.is_file():
        plan_cache.unlink()

    return {"applied": applied, "skipped": skipped, "deferred": deferred, "log": log}


def _is_safe_path_component(s: str) -> bool:
    if not isinstance(s, str) or not s:
        return False
    if "/" in s or "\\" in s:
        return False
    if s in (".", "..") or s.startswith(".."):
        return False
    if s.startswith("."):
        return False
    return True


def _slugs_in_op(op: dict) -> list[str]:
    slugs: list[str] = []
    if "slug" in op and isinstance(op["slug"], str):
        slugs.append(op["slug"])
    for s in op.get("inputs", []) or []:
        if isinstance(s, str):
            slugs.append(s)
    for s in op.get("slugs", []) or []:
        if isinstance(s, str):
            slugs.append(s)
    out = op.get("output") or {}
    if isinstance(out.get("slug"), str):
        slugs.append(out["slug"])
    return slugs



def _apply_merge_like(op, spec_dir, channel_root, specialist, today, log):
    inputs = op["inputs"]
    output = op["output"]
    out_slug = output["slug"]
    out_path = spec_dir / f"{out_slug}.md"

    oldest_created = None
    union_tags: set[str] = set(output.get("tags", []) or [])
    for slug in inputs:
        src = spec_dir / f"{slug}.md"
        if not src.is_file():
            continue
        parsed = _parse_entry_safe(src)
        if parsed:
            union_tags.update(parsed.get("tags") or [])
            cre = parsed.get("created", "")
            if cre and (oldest_created is None or cre < oldest_created):
                oldest_created = cre

    fm = _build_frontmatter(
        specialist=specialist,
        scope=_infer_scope(channel_root),
        slug=out_slug,
        created=oldest_created or today,
        updated=today,
        tags=sorted(union_tags),
    )
    body = output.get("body", "").rstrip() + "\n"
    out_path.write_text(fm + "\n" + body)

    # Archive all inputs (except the output slug) into a single dated dir.
    to_archive = [slug for slug in inputs if slug != out_slug and (spec_dir / f"{slug}.md").is_file()]
    if to_archive:
        import shutil
        archive_dir = _allocate_archive_dir(channel_root, specialist, today)
        for slug in to_archive:
            src = spec_dir / f"{slug}.md"
            shutil.move(str(src), str(archive_dir / src.name))
            log.append(f"{today} {op['op']} {specialist} {out_slug} <- {slug}")


def _apply_archive(op, channel_root, specialist, today, log):
    slug = op["slug"]
    archive_entry(channel_root, specialist, slug, today=today)
    log.append(f"{today} archive {specialist} {slug}")


def _append_deferred(channel_root: Path, op: dict, today: str) -> None:
    p = channel_root / CHANNEL_DEFERRED_NAME
    p.parent.mkdir(parents=True, exist_ok=True)
    line = f"{today} {op.get('target', '')} — {op.get('reason', '')}\n"
    with p.open("a") as fh:
        fh.write(line)


def _build_frontmatter(*, specialist, scope, slug, created, updated, tags) -> str:
    tag_line = "[" + ", ".join(tags) + "]"
    return (
        "---\n"
        f"specialist: {specialist}\n"
        f"scope: {scope}\n"
        f"slug: {slug}\n"
        f"created: {created}\n"
        f"updated: {updated}\n"
        f"tags: {tag_line}\n"
        "---\n"
    )


def _infer_scope(channel_root: Path) -> str:
    """Best-effort scope inference: 'project' if path contains '/.buddy/', else 'global'."""
    s = str(channel_root)
    return "project" if "/.buddy/" in s or s.endswith(".buddy/memory") or "/.buddy/memory" in s else "global"



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



def apply_plan_from_cache() -> str:
    """Walk channel roots, find cached plans, apply each. Returns a summary string."""
    raise NotImplementedError("filled in by Task 14")


def archive_entry(channel_root: Path, specialist: str, slug: str, *, today: str | None = None) -> Path:
    """Move <channel>/<specialist>/<slug>.md into <channel>/<specialist>/.archive/<YYYY-MM-DD>/.

    Returns the new archive path. Raises FileNotFoundError if source missing.
    Handles same-day re-runs by suffixing the archive dir (-2, -3, ...).
    """
    today = today or _today_iso()
    src = channel_root / specialist / f"{slug}.md"
    if not src.is_file():
        raise FileNotFoundError(f"no such entry: {src}")

    archive_dir = _allocate_archive_dir(channel_root, specialist, today)
    dst = archive_dir / src.name
    shutil.move(str(src), str(dst))
    return dst


def _allocate_archive_dir(channel_root: Path, specialist: str, today: str) -> Path:
    base = channel_root / specialist / ARCHIVE_DIRNAME
    base.mkdir(parents=True, exist_ok=True)
    candidate = base / today
    if not candidate.exists() or _is_empty(candidate):
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    n = 2
    while True:
        c = base / f"{today}-{n}"
        if not c.exists() or _is_empty(c):
            c.mkdir(parents=True, exist_ok=True)
            return c
        n += 1


def _is_empty(p: Path) -> bool:
    try:
        return not any(p.iterdir())
    except OSError:
        return True
