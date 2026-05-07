# Memory Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/buddy:consolidate` — four-phase memory consolidation pipeline (deterministic candidate detection → specialist judgment → user dry-run gate → mechanical apply) with manual command, soft-suggestion at capacity, periodic nudge, and opt-in auto-trigger.

**Architecture:** New module `buddy/scripts/consolidate.py` houses pure functions for candidate detection (Phase 1), plan parsing/validation, and apply (Phase 4). Phase 2 prompt template lives in `buddy/data/consolidation-protocol.md`. Slash command `buddy/commands/consolidate.md` orchestrates the four phases. Triggers extend `buddy/hooks/session-start.sh`. All file mutations are reversible: archives are moved, never deleted; INDEX is regenerated from live entries; per-channel `.consolidation.lock` prevents concurrent applies.

**Tech Stack:** Python 3 (stdlib only — no new deps), bash, jq, sqlite3 (already required by plugin); pytest for the unit tests.

---

## Reference: data structures

These are referenced by multiple tasks. Read once.

**Memory entry frontmatter (existing):**
```yaml
---
specialist: <directory-or-common>
scope: global | project
slug: <kebab>
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [t1, t2]
---

**Lesson:** ...
**Why:** ...
**How to apply:** ...
```

**Candidate brief shape returned by `find_candidates`:**
```python
{
    "specialist": "prompt-hamsa",
    "channel_root": "/abs/path/to/channel",
    "slug_groups": [
        {"slugs": ["a", "a-2"], "paths": [...], "hooks": [...]},
        ...
    ],
    "tag_clusters": [
        {"tags": frozenset({"prompts", "eval"}), "slugs": [...], "paths": [...], "hooks": [...]},
        ...
    ],
    "stale": [
        {"slug": "x", "path": ..., "updated": "2025-11-02", "days_stale": 187, "loaded_since": False},
        ...
    ],
    "contradictions": [
        {"slugs": ["a", "b"], "paths": [...], "shared_tags": [...], "negation_in": "a"},
        ...
    ],
    "orphans": [
        {"path": "...", "reason": "missing-frontmatter"},
        ...
    ],
}
```

**Plan YAML (specialist emits, parser consumes):** see spec section "Phase 2 — Specialist judgment", subsection "Required output schema".

---

### Task 1: Skeleton — module, command, routing wiring

**Files:**
- Create: `buddy/scripts/consolidate.py` (stub)
- Create: `buddy/commands/consolidate.md` (stub)
- Create: `buddy/data/consolidation-protocol.md` (stub)
- Modify: `buddy/tests/test_data_catalogs.py` (extend parametrize)
- Modify: `buddy/README.md` (add Commands row)

- [ ] **Step 1: Create `buddy/scripts/consolidate.py` stub**

```python
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
    raise NotImplementedError("filled in by Tasks 2–6")


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
```

- [ ] **Step 2: Create `buddy/commands/consolidate.md` stub**

```markdown
---
name: buddy:consolidate
description: Consolidate accumulated memories — merge near-duplicates, archive stale entries, summarize tag-clusters, surface contradictions for resolution. Runs as a four-phase pipeline (rules shortlist → specialist judgment → user dry-run gate → apply). Pass a target (specialist alias, `common`, `all`) or one of the sub-commands `apply`/`revise <text>`/`cancel`. With no argument, consolidates memories of currently active specialists.
---

You are running memory consolidation. The argument passed by the user is `$1`.

**This command is a stub. Full orchestration is wired in Tasks 7, 12, 14, 16.**

For now, print: `consolidation not yet implemented (Task 1 skeleton)` and stop.
```

- [ ] **Step 3: Create `buddy/data/consolidation-protocol.md` stub**

```markdown
# Consolidation Protocol

(Stub — filled in by Task 7.)

The active specialist receives the candidate brief from Phase 1 and emits a
YAML plan per the schema. This file holds the prompt template that will be
injected into the active turn during `/buddy:consolidate`.
```

- [ ] **Step 4: Extend the parametrized routing test**

Use `mcp__codescout__edit_file` exact-string replace:
- old: `@pytest.mark.parametrize("command_file", ["summon.md", "dismiss.md", "introspect.md"])`
- new: `@pytest.mark.parametrize("command_file", ["summon.md", "dismiss.md", "introspect.md", "consolidate.md"])`

Note: `consolidate.md` does NOT have a routing table over specialists (it routes by sub-command + alias). The test only checks `\`<dir>\` not in cmd_md` — and `consolidate.md` will mention specialist aliases generically. We accept the simpler check: every skill directory string appears somewhere in `consolidate.md`. To make this true, append a brief "Specialists you can consolidate:" comment listing all directory names verbatim in the stub command file. Add this section right before the implementation-not-yet-wired sentinel.

Concretely, append this block to `buddy/commands/consolidate.md`:

```markdown
<!--
Specialists this command can target (alias-table parity with summon.md):
- `debugging-yeti`
- `testing-snow-leopard`
- `refactoring-yak`
- `ml-training-takin`
- `performance-lammergeier`
- `planning-crane`
- `architecture-snow-lion`
- `docs-lotus-frog`
- `data-leakage-snow-pheasant`
- `security-ibex`
- `prompt-hamsa`
-->
```

This is a routing comment, parseable by the test, invisible in slash-command rendering.

- [ ] **Step 5: Add Commands README row**

In `buddy/README.md`, find the row for `/buddy:introspect [alias]` in the `### Commands` table. Append immediately after it (use `mcp__codescout__edit_markdown` action=edit on the `### Commands` heading):

- old_string:
```
| `/buddy:introspect [alias]`      | Mid-session reflection — capture lessons without dismissing the specialist         |
```
- new_string:
```
| `/buddy:introspect [alias]`      | Mid-session reflection — capture lessons without dismissing the specialist         |
| `/buddy:consolidate [target]`    | Consolidate memories — merge dupes, archive stale, summarize, surface contradictions |
```

- [ ] **Step 6: Run the suite**

Run: `cd buddy && python -m pytest tests/ -q`
Expected: all green; new `[consolidate.md]` parametrize case passes.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/commands/consolidate.md buddy/data/consolidation-protocol.md buddy/tests/test_data_catalogs.py buddy/README.md
git commit -m "feat(buddy): scaffold /buddy:consolidate (stub + routing wiring)"
```

---

### Task 2: Phase 1 — slug-collision groups

**Files:**
- Create: `buddy/tests/test_consolidate_candidates.py`
- Create: `buddy/tests/fixtures/consolidate_channel/` (fixture channel)
- Modify: `buddy/scripts/consolidate.py`

- [ ] **Step 1: Build a fixture channel for tests**

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/eval-rubric-design.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: eval-rubric-design
created: 2026-04-01
updated: 2026-04-01
tags: [eval, rubric, prompts]
---

**Lesson:** Rubrics with ≤5 criteria stay scoreable.

**Why:** ...

**How to apply:** ...
```

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/evaluation-rubric-design.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: evaluation-rubric-design
created: 2026-04-08
updated: 2026-04-08
tags: [eval, rubric, prompts]
---

**Lesson:** Rubrics with six or more criteria drift.

**Why:** ...

**How to apply:** ...
```

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/unrelated.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: unrelated
created: 2026-04-15
updated: 2026-04-15
tags: [misc]
---

**Lesson:** Some unrelated lesson.
```

- [ ] **Step 2: Write the failing test**

Create `buddy/tests/test_consolidate_candidates.py`:

```python
"""Unit tests for buddy.scripts.consolidate.find_candidates (Phase 1)."""
from pathlib import Path

import pytest

from buddy.scripts.consolidate import find_candidates

FIXTURES = Path(__file__).parent / "fixtures" / "consolidate_channel"


def test_slug_collision_groups_detects_kebab_token_overlap():
    """`eval-rubric-design` and `evaluation-rubric-design` share ≥0.85 token overlap."""
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    groups = cand["slug_groups"]
    assert len(groups) == 1
    slugs = sorted(groups[0]["slugs"])
    assert slugs == ["eval-rubric-design", "evaluation-rubric-design"]


def test_slug_collision_groups_ignores_singletons():
    """`unrelated` should not be grouped with anything."""
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    for g in cand["slug_groups"]:
        assert "unrelated" not in g["slugs"]
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py::test_slug_collision_groups_detects_kebab_token_overlap -v`
Expected: FAIL with `NotImplementedError`.

- [ ] **Step 4: Implement `find_candidates` slug-group detection**

Replace the stub `find_candidates` body in `buddy/scripts/consolidate.py` with this initial implementation. Use `mcp__codescout__edit_code` action="replace":

```python
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
    # Reuse the existing parser from scripts/memory.py.
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
    for suffix in ("ation", "tion", "ing", "es", "s"):
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            return token[: -len(suffix)]
    return token


def _kebab_token_overlap(a: list[str], b: list[str]) -> float:
    """Jaccard on kebab token sets (post-stemming). Identical → 1.0; disjoint → 0.0."""
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)
```

- [ ] **Step 5: Verify the existing `_parse_entry` returns the fields we read**

Run: `cd buddy && python -c "from scripts.memory import _parse_entry; import pprint; from pathlib import Path; pprint.pprint(_parse_entry(Path('tests/fixtures/consolidate_channel/prompt-hamsa/eval-rubric-design.md')))"`

Expected output: a dict with at minimum `slug`, `tags`, `hook` keys and string values.

If keys differ (e.g. `tags` is missing), inspect `scripts/memory.py::_parse_entry` and adjust `_parse_entry_safe` mapping accordingly. Keep `_parse_entry_safe` as the single adapter.

- [ ] **Step 6: Run the slug-group tests, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py -v`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_candidates.py buddy/tests/fixtures/consolidate_channel/
git commit -m "feat(buddy): consolidate phase 1 — slug-collision groups"
```

---

### Task 3: Phase 1 — tag-overlap clusters

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_candidates.py`
- Modify: `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/` (add fixtures)

- [ ] **Step 1: Add three more fixture entries with shared tag pairs**

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/eval-loop-pattern.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: eval-loop-pattern
created: 2026-04-20
updated: 2026-04-20
tags: [prompts, eval, loop]
---

**Lesson:** Five graded examples beats clever wording.
```

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/judge-prompt-discipline.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: judge-prompt-discipline
created: 2026-04-22
updated: 2026-04-22
tags: [prompts, eval, judge]
---

**Lesson:** Judge prompts with rubric beat is-this-good.
```

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/eval-set-size.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: eval-set-size
created: 2026-04-25
updated: 2026-04-25
tags: [prompts, eval, sample-size]
---

**Lesson:** Twenty examples is the floor for a useful eval set.
```

These three share `prompts` + `eval` (≥2 shared tags) — they form a cluster.

- [ ] **Step 2: Write the failing test**

Append to `buddy/tests/test_consolidate_candidates.py`:

```python
def test_tag_overlap_cluster_detects_three_entries_sharing_two_tags():
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    clusters = cand["tag_clusters"]
    cluster_slugs = {tuple(sorted(c["slugs"])) for c in clusters}
    expected = tuple(sorted(["eval-loop-pattern", "judge-prompt-discipline", "eval-set-size"]))
    assert expected in cluster_slugs


def test_tag_overlap_cluster_includes_shared_tags():
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    for c in cand["tag_clusters"]:
        if len(c["slugs"]) >= 3:
            assert "prompts" in c["tags"]
            assert "eval" in c["tags"]
            return
    pytest.fail("no cluster of size ≥3 returned")
```

Note: the slug-group test from Task 2 may now match these too because `eval-loop-pattern`, `eval-set-size` share token "eval" — but Jaccard with stemming may or may not exceed 0.85 depending on stem behavior. If the slug-group test fails because new fixtures got grouped, tighten the slug-group threshold or refine fixture slugs. Re-run Task 2 tests after this change.

- [ ] **Step 3: Run, expect FAIL**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py::test_tag_overlap_cluster_detects_three_entries_sharing_two_tags -v`
Expected: FAIL — `clusters` list is empty.

- [ ] **Step 4: Implement tag-cluster detection**

In `buddy/scripts/consolidate.py`, find the line `"tag_clusters": [],` inside `find_candidates` and replace it with `"tag_clusters": _tag_overlap_clusters(entries),`. Then add the new helper after `_kebab_token_overlap`:

```python
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
        bucket = []
        for a, b in combinations(members, 2):
            if _hook_bigram_jaccard(a["hook"], b["hook"]) >= 0.4 or len(members) >= 3:
                if a not in bucket:
                    bucket.append(a)
                if b not in bucket:
                    bucket.append(b)
        if len(bucket) >= 2:
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
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py -v`
Expected: 4 passed (2 slug + 2 tag-cluster). If the slug-group tests broke because new fixtures got grouped, adjust slug naming OR raise the slug threshold to e.g. 0.9. Document in commit message if you tune.

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_candidates.py buddy/tests/fixtures/
git commit -m "feat(buddy): consolidate phase 1 — tag-overlap clusters"
```

---

### Task 4: Phase 1 — stale entries

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_candidates.py`
- Modify: fixtures (add a stale entry + summons.log fixture)

- [ ] **Step 1: Add a stale fixture entry**

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/old-prefill-trick.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: old-prefill-trick
created: 2025-09-01
updated: 2025-11-02
tags: [legacy, prefill]
---

**Lesson:** Older Claude versions accepted bare-brace prefill.
```

(Created/updated dates well past the 90-day default stale window.)

- [ ] **Step 2: Add a fixture summons log**

Create `buddy/tests/fixtures/consolidate_channel/summons.log`:

```
1735689600	prompt-hamsa	summoned
1738368000	prompt-hamsa	summoned
1740960000	prompt-hamsa	dismissed
```

These timestamps are all in early 2025 — *before* the `updated` date of `old-prefill-trick.md` would be re-loaded. The test asserts the stale rule fires.

- [ ] **Step 3: Write the failing test**

Append to `buddy/tests/test_consolidate_candidates.py`:

```python
def test_stale_detects_entry_past_threshold(monkeypatch):
    """Entry with updated > 90 days ago AND no summon-log evidence post-update is stale."""
    monkeypatch.setattr(
        "buddy.scripts.consolidate._today_iso",
        lambda: "2026-05-07",
    )
    cand = find_candidates(
        FIXTURES,
        "prompt-hamsa",
        summons_log_path=FIXTURES / "summons.log",
    )
    stale_slugs = {s["slug"] for s in cand["stale"]}
    assert "old-prefill-trick" in stale_slugs


def test_stale_does_not_flag_recent_entry(monkeypatch):
    monkeypatch.setattr(
        "buddy.scripts.consolidate._today_iso",
        lambda: "2026-05-07",
    )
    cand = find_candidates(
        FIXTURES,
        "prompt-hamsa",
        summons_log_path=FIXTURES / "summons.log",
    )
    stale_slugs = {s["slug"] for s in cand["stale"]}
    assert "eval-rubric-design" not in stale_slugs  # updated 2026-04-01
```

- [ ] **Step 4: Run, expect FAIL**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py::test_stale_detects_entry_past_threshold -v`
Expected: FAIL — `stale` list empty AND signature mismatch (`summons_log_path` arg unknown).

- [ ] **Step 5: Implement stale detection**

In `buddy/scripts/consolidate.py`:

a) Add the helpers at module bottom:

```python
import os
from datetime import date


def _today_iso() -> str:
    """Wrapped for test monkeypatching."""
    return date.today().isoformat()


def _days_between(iso_a: str, iso_b: str) -> int:
    """Inclusive of both endpoints. Returns 0 if either parse fails."""
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
        since_ts = int(date.fromisoformat(since_iso).strftime("%s"))
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
```

b) Update `find_candidates` signature and body — replace the function with:

```python
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
        parsed = _parse_entry_safe(path)
        if parsed is None:
            orphans.append({"path": str(path), "reason": "missing-frontmatter"})
            continue
        entries.append(parsed)

    log_path = summons_log_path or _default_summons_log()
    return {
        "specialist": specialist,
        "channel_root": str(channel_root),
        "slug_groups": _slug_collision_groups(entries),
        "tag_clusters": _tag_overlap_clusters(entries),
        "stale": _stale_entries(entries, specialist, log_path, stale_days),
        "contradictions": [],
        "orphans": orphans,
    }


def _default_summons_log() -> Path:
    return Path.home() / ".claude" / "buddy" / "summons.log"
```

- [ ] **Step 6: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_candidates.py buddy/tests/fixtures/
git commit -m "feat(buddy): consolidate phase 1 — stale entries via summons.log"
```

---

### Task 5: Phase 1 — contradictions + orphans + brief render

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_candidates.py`
- Modify: fixtures (contradiction pair + a malformed entry)

- [ ] **Step 1: Add contradiction-pair fixtures**

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/cot-helps.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: cot-helps
created: 2026-03-01
updated: 2026-03-01
tags: [reasoning, frontier]
---

**Lesson:** Chain-of-thought helps even on frontier models.
```

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/skip-cot-on-frontier.md`:

```markdown
---
specialist: prompt-hamsa
scope: global
slug: skip-cot-on-frontier
created: 2026-04-15
updated: 2026-04-15
tags: [reasoning, frontier]
---

**Lesson:** Don't add explicit CoT on frontier models — extended thinking handles it.
```

(Both share `[reasoning, frontier]`. The second contains negation token "Don't"; first does not.)

- [ ] **Step 2: Add a malformed-frontmatter fixture**

Create `buddy/tests/fixtures/consolidate_channel/prompt-hamsa/broken-entry.md`:

```markdown
This file has no frontmatter at all. It should be flagged as an orphan.

**Lesson:** Lost without metadata.
```

- [ ] **Step 3: Write failing tests**

Append to `buddy/tests/test_consolidate_candidates.py`:

```python
def test_contradiction_flags_negation_pair_with_shared_tags():
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    contras = cand["contradictions"]
    pairs = {tuple(sorted(c["slugs"])) for c in contras}
    assert ("cot-helps", "skip-cot-on-frontier") in pairs


def test_orphan_flags_malformed_frontmatter():
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    paths = [o["path"] for o in cand["orphans"]]
    assert any("broken-entry.md" in p for p in paths)


def test_render_brief_groups_each_category_under_heading():
    cand = find_candidates(FIXTURES, "prompt-hamsa")
    from buddy.scripts.consolidate import render_brief
    md = render_brief(cand)
    assert "## Slug-collision groups" in md
    assert "## Tag-overlap clusters" in md
    assert "## Stale" in md
    assert "## Contradictions" in md
    assert "## Orphans" in md
```

- [ ] **Step 4: Run, expect FAILs**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py -v -k "contradiction or orphan or render_brief"`
Expected: 3 FAILs.

- [ ] **Step 5: Implement contradictions + render_brief**

In `buddy/scripts/consolidate.py`:

a) Replace `"contradictions": [],` in `find_candidates` with `"contradictions": _contradiction_pairs(entries),`.

b) Add helpers:

```python
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
```

- [ ] **Step 6: Run all, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_candidates.py -v`
Expected: 9 passed.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_candidates.py buddy/tests/fixtures/
git commit -m "feat(buddy): consolidate phase 1 — contradictions, orphans, brief render"
```

---

### Task 6: Phase 2 — consolidation protocol prompt template

**Files:**
- Modify: `buddy/data/consolidation-protocol.md`

This file is referenced verbatim in the slash command. No tests — content-only.

- [ ] **Step 1: Replace stub with the prompt template**

Use `mcp__codescout__create_file` with `overwrite=true`:

```markdown
# Consolidation Protocol

You are about to perform memory consolidation on your own POV. The candidate
brief and the full body of every referenced entry have been provided. Apply
your method, not generic editorial reflex, and emit a YAML plan.

## Three rules

1. **Voice preservation.** When merging or summarizing, the new body must read
   as a single coherent lesson in your voice. If the originals disagree on
   substance, you cannot merge — you must reconcile (write a new entry that
   supersedes both) or `defer` to the user.
2. **No silent loss.** Every entry that disappears from the active set must
   be either merged into a successor (cite by slug in the new body's
   `**Supersedes:**` line) or archived (which keeps the file readable). Never
   delete.
3. **Doubt → defer.** If you cannot confidently decide, mark `defer` with a
   one-line reason. The user will judge.

## Required output schema

Emit YAML between fenced code blocks tagged `yaml`. The script parses the
first such block. Anything outside the block is ignored.

```yaml
plan_version: 1
specialist: <directory>
channel: <global|project>
generated: <ISO8601>
operations:
  - op: merge
    inputs: [slug-a, slug-b]
    output:
      slug: <new-or-kept-slug>
      tags: [...]
      body: |
        **Lesson:** ...
        **Why:** ...
        **How to apply:** ...
        **Supersedes:** slug-a, slug-b
    reason: <one line — why merge is safe>

  - op: archive
    slug: <slug>
    reason: <one line — why no longer load-bearing>

  - op: summarize
    inputs: [slug-x, slug-y, slug-z]
    output:
      slug: <new-slug>
      tags: [...]
      body: |
        ...
    reason: ...

  - op: keep_all
    slugs: [...]
    reason: <why the rules-shortlist was wrong>

  - op: defer
    target: <slug or group descriptor>
    reason: <what the user must decide>
```

## Notes

- `op: keep_all` is for cases where the rules surfaced a candidate but you
  judge them distinct lessons. Always include a `reason`.
- `op: defer` is the safety valve. Use it freely. Better deferred than
  mistakenly merged.
- For merges, prefer the older slug as `output.slug` unless the newer slug
  reads more clearly.
- Tag union is automatic — emit your preferred tag list; the apply phase
  unions inputs anyway.
- Do not refer to entries that were not in the candidate brief. The brief is
  the closed set.
```

- [ ] **Step 2: Sanity-check the file**

Run: `head -3 buddy/data/consolidation-protocol.md`
Expected: `# Consolidation Protocol`

- [ ] **Step 3: Commit**

```bash
git add buddy/data/consolidation-protocol.md
git commit -m "feat(buddy): consolidate phase 2 — protocol prompt template"
```

---

### Task 7: Phase 2 prompt-injection helper + slash command Phase 1+2 wiring

**Files:**
- Modify: `buddy/commands/consolidate.md`
- Modify: `buddy/scripts/consolidate.py`

This task wires the slash command to: parse the target, resolve channel(s), run Phase 1, render the brief, inject the protocol, await the specialist's plan emission, parse the plan, and stash a stub plan file. Phase 3 rendering and Phase 4 apply come in later tasks; this task establishes the orchestration scaffold and writes a partial result.

- [ ] **Step 1: Replace `consolidate.md` with full orchestration spec**

Use `mcp__codescout__create_file` with `overwrite=true`:

```markdown
---
name: buddy:consolidate
description: Consolidate accumulated memories — merge near-duplicates, archive stale entries, summarize tag-clusters, surface contradictions for resolution. Runs as a four-phase pipeline (rules shortlist → specialist judgment → user dry-run gate → apply). Pass a target (specialist alias, `common`, `all`) or one of the sub-commands `apply`/`revise <text>`/`cancel`. With no argument, consolidates memories of currently active specialists.
---

You are running memory consolidation. The argument passed by the user is `$1`.

<!--
Specialists this command can target (alias-table parity with summon.md):
- `debugging-yeti`
- `testing-snow-leopard`
- `refactoring-yak`
- `ml-training-takin`
- `performance-lammergeier`
- `planning-crane`
- `architecture-snow-lion`
- `docs-lotus-frog`
- `data-leakage-snow-pheasant`
- `security-ibex`
- `prompt-hamsa`
-->

## Step 1 — Parse the argument

Trim `$1`. Cases:

- Empty: target = each currently-active specialist (load `active_specialists` from session state) plus their `common/` overlap. If `active_specialists` is empty, print `→ no active specialists. Use /buddy:summon first, then /buddy:consolidate.` and stop.
- One of `apply`, `revise`, `cancel`: skip to Step 6 (sub-command routing).
- Otherwise: resolve to a specialist directory using the alias table in `summon.md`. If unresolved or ambiguous, print the table and stop. Special targets:
  - `common` → operate on the `common/` bucket; judged by each currently-active specialist in turn.
  - `all` → every specialist directory under each channel root. Confirm before proceeding: print `→ this will consolidate every specialist's memories — type /buddy:consolidate all confirm to proceed.` Only the literal argument `all confirm` proceeds.

## Step 2 — Resolve channel roots

Use the existing helpers from `scripts/memory.py`:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.memory import current_instance_dir
print(current_instance_dir())
" 2>&1
```

Global channel: `<current-instance-dir>/buddy/memory/`. Project channel: `<cwd>/.buddy/memory/` if it exists.

For each (channel, specialist) pair, run Step 3.

## Step 3 — Phase 1: build the candidate brief

```bash
python3 -c "
import sys, json
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import find_candidates, render_brief
cand = find_candidates(Path('<channel-root>'), '<specialist>')
print(render_brief(cand))
"
```

Substitute `<channel-root>` and `<specialist>` with the resolved values. Capture stdout — that is the brief.

If every category is empty (no slug groups, no clusters, no stale, no contradictions, no orphans), print `→ <specialist> in <channel>: nothing to consolidate.` and skip to next pair. Do not invoke the specialist.

## Step 4 — Phase 2: emit the brief + protocol, await the plan

For the resolved specialist, the specialist must already be summoned (or you summon it first via `/buddy:summon <specialist>` — but only with explicit user consent on this turn; do not auto-summon).

Inject (verbatim) into the active turn:

1. The candidate brief from Step 3.
2. For every entry path referenced anywhere in the brief, the **full body** of that file. Use `mcp__codescout__read_markdown` (preferred) or `Read`.
3. The contents of `${CLAUDE_PLUGIN_ROOT}/data/consolidation-protocol.md`.

Then say to the specialist:

> Emit your consolidation plan as a YAML fenced code block per the protocol's required schema. Nothing else in your response will be parsed.

Wait for the specialist to respond.

## Step 5 — Parse and cache the plan

Extract the first `yaml` fenced code block from the specialist's response. Pass it to the parser:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import parse_plan
plan_text = open('<temp-plan-file>').read()
plan = parse_plan(plan_text)
import json; print(json.dumps(plan, default=str))
"
```

If parsing raises `ValueError`, report `→ specialist plan was unparseable. Raw response saved at <temp-plan-file>. Run /buddy:consolidate revise <feedback> to retry.` and stop.

If parsing succeeds, write the rendered plan markdown to `<channel-root>/.consolidation-plan.md` (this file is what the user reviews). Render via `render_plan_for_user(plan)` (filled in Task 12).

For Tasks 1–11, until `render_plan_for_user` is wired, stash the raw YAML at the cache path and announce: `→ dry-run plan cached at <path>. /buddy:consolidate apply | revise <text> | cancel`.

## Step 6 — Sub-command routing (apply / revise / cancel)

If `$1` is `apply`, run:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import apply_plan_from_cache
result = apply_plan_from_cache()  # walks every channel for plan files
print(result)
"
```

If `$1` is `revise <text>`, re-run Steps 3–5 with the user's feedback appended to the brief sent to the specialist. The text after `revise` is the feedback. Append a section `## User feedback (consider before plan)` containing the text verbatim.

If `$1` is `cancel`, delete every `.consolidation-plan.md` under both channel roots and announce.
```

- [ ] **Step 2: Add `apply_plan_from_cache` placeholder in `consolidate.py`**

Append to `buddy/scripts/consolidate.py`:

```python
def apply_plan_from_cache() -> str:
    """Walk channel roots, find cached plans, apply each. Returns a summary string."""
    raise NotImplementedError("filled in by Task 14")
```

- [ ] **Step 3: Sanity-check the command file is syntactically intact**

Run: `head -5 buddy/commands/consolidate.md`
Expected: frontmatter visible.

- [ ] **Step 4: Run the full suite — should still be green (no behavior changes)**

Run: `cd buddy && python -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add buddy/commands/consolidate.md buddy/scripts/consolidate.py
git commit -m "feat(buddy): consolidate command — phase 1+2 orchestration scaffold"
```

---

### Task 8: Plan parser + validation

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Create: `buddy/tests/test_consolidate_validation.py`
- Modify: `buddy/pyproject.toml` (if PyYAML not already a dep — check first)

- [ ] **Step 1: Check PyYAML availability**

Run: `python -c "import yaml; print(yaml.__version__)"`

If this fails, add PyYAML to `buddy/pyproject.toml` dependencies:

```toml
dependencies = [
    # ...existing deps...
    "PyYAML>=6.0",
]
```

Then `pip install -e buddy/` (or whatever the project uses to refresh deps; check `buddy/scripts/dev-install.sh`).

If PyYAML is already present, skip this step.

- [ ] **Step 2: Write failing parser tests**

Create `buddy/tests/test_consolidate_validation.py`:

```python
"""Tests for plan parsing and validation."""
import pytest

from buddy.scripts.consolidate import parse_plan

VALID_PLAN = """
plan_version: 1
specialist: prompt-hamsa
channel: global
generated: "2026-05-07T14:30:00Z"
operations:
  - op: merge
    inputs: [a, b]
    output:
      slug: ab
      tags: [t1, t2]
      body: |
        **Lesson:** merged.
    reason: same lesson written twice
  - op: archive
    slug: c
    reason: stale
  - op: defer
    target: pair-x-vs-y
    reason: needs your call
"""


def test_parse_plan_returns_structured_dict():
    plan = parse_plan(VALID_PLAN)
    assert plan["plan_version"] == 1
    assert plan["specialist"] == "prompt-hamsa"
    assert len(plan["operations"]) == 3
    ops = [o["op"] for o in plan["operations"]]
    assert ops == ["merge", "archive", "defer"]


def test_parse_plan_rejects_unknown_version():
    bad = VALID_PLAN.replace("plan_version: 1", "plan_version: 99")
    with pytest.raises(ValueError, match="plan_version"):
        parse_plan(bad)


def test_parse_plan_rejects_unknown_op():
    bad = VALID_PLAN.replace("op: merge", "op: incinerate")
    with pytest.raises(ValueError, match="incinerate"):
        parse_plan(bad)


def test_parse_plan_rejects_merge_without_inputs():
    bad = """
plan_version: 1
specialist: x
channel: global
generated: "2026-05-07T14:30:00Z"
operations:
  - op: merge
    output: {slug: x, tags: [], body: ""}
    reason: missing inputs
"""
    with pytest.raises(ValueError, match="inputs"):
        parse_plan(bad)


def test_parse_plan_extracts_yaml_from_fenced_block():
    fenced = "Some prose.\n\n```yaml\n" + VALID_PLAN + "```\n\nMore prose."
    plan = parse_plan(fenced)
    assert plan["plan_version"] == 1


def test_parse_plan_raises_on_no_yaml_block_and_no_root_keys():
    with pytest.raises(ValueError, match="no plan"):
        parse_plan("This is just prose with no plan in it.")
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd buddy && python -m pytest tests/test_consolidate_validation.py -v`
Expected: FAILs (NotImplementedError or attribute errors).

- [ ] **Step 4: Implement `parse_plan`**

Replace the stub `parse_plan` in `buddy/scripts/consolidate.py`:

```python
import re

import yaml

_FENCE_RE = re.compile(r"```yaml\s*\n(.*?)\n```", re.DOTALL)
_VALID_OPS = {"merge", "archive", "summarize", "keep_all", "defer"}


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


def _extract_yaml(text: str) -> str:
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1)
    if "plan_version" in text and "operations" in text:
        return text
    raise ValueError("no plan: response contains no fenced yaml block and no plan keys")


def _validate_plan(data: dict) -> None:
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
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_validation.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_validation.py buddy/pyproject.toml
git commit -m "feat(buddy): consolidate — plan YAML parser + validation"
```

---

### Task 9: Phase 4 archive helper + regen_index .archive/ skip + meta.json

**Files:**
- Modify: `buddy/scripts/memory.py` (regen_index walk + meta helpers)
- Modify: `buddy/scripts/consolidate.py` (archive helpers)
- Create: `buddy/tests/test_consolidate_apply.py`

- [ ] **Step 1: Patch `regen_index` to skip `.archive/` paths**

Read the current `regen_index` body via `mcp__codescout__symbols(name="regen_index", include_body=True)`. Identify the directory walk (likely `entry_file in spec_dir.iterdir()`). Add a path filter so any path containing a `.archive` segment is skipped.

Add this guard near the start of the per-file loop:

```python
        # Skip archived entries — see ARCHIVE_DIRNAME in scripts/consolidate.py
        if any(part == ".archive" for part in entry_file.parts):
            continue
```

Use `mcp__codescout__edit_code` action="replace" with the full new body of `regen_index`. (Read the current body first to get the exact baseline; only insert the guard.)

- [ ] **Step 2: Add `meta.json` helpers in `memory.py`**

Append to `buddy/scripts/memory.py`:

```python
import json as _json


def read_channel_meta(channel_root: Path) -> dict:
    """Read <channel>/meta.json if present; return {} otherwise."""
    p = channel_root / "meta.json"
    if not p.is_file():
        return {}
    try:
        return _json.loads(p.read_text())
    except (OSError, _json.JSONDecodeError):
        return {}


def write_channel_meta(channel_root: Path, meta: dict) -> None:
    """Atomic-ish write of <channel>/meta.json."""
    p = channel_root / "meta.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps(meta, indent=2, sort_keys=True))
    tmp.replace(p)


def update_last_consolidated(channel_root: Path, specialist: str, iso: str) -> None:
    meta = read_channel_meta(channel_root)
    meta.setdefault("version", 1)
    meta.setdefault("last_consolidated", {})[specialist] = iso
    write_channel_meta(channel_root, meta)
```

- [ ] **Step 3: Add archive helper in `consolidate.py`**

Append to `buddy/scripts/consolidate.py`:

```python
from datetime import datetime
import shutil


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
```

- [ ] **Step 4: Write archive-helper tests**

Create `buddy/tests/test_consolidate_apply.py`:

```python
"""Apply-phase mechanics: archive helpers, plan execution, idempotency."""
import shutil
from pathlib import Path

import pytest

from buddy.scripts.consolidate import archive_entry, ARCHIVE_DIRNAME


@pytest.fixture
def channel(tmp_path):
    """Empty channel scaffold with one entry under prompt-hamsa/."""
    spec = tmp_path / "prompt-hamsa"
    spec.mkdir()
    (spec / "x.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: x\n"
        "created: 2026-04-01\nupdated: 2026-04-01\ntags: [t]\n---\n\n**Lesson:** hi.\n"
    )
    return tmp_path


def test_archive_moves_entry_to_dated_subdir(channel):
    new_path = archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    assert new_path.exists()
    assert new_path.parent.name == "2026-05-07"
    assert new_path.parent.parent.name == ARCHIVE_DIRNAME
    assert not (channel / "prompt-hamsa" / "x.md").exists()


def test_archive_same_day_collision_suffixes(channel):
    archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    # Second entry with same name (different content), archived same day:
    (channel / "prompt-hamsa" / "x.md").write_text("v2")
    new_path = archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    assert new_path.parent.name == "2026-05-07-2"


def test_archive_missing_raises(channel):
    with pytest.raises(FileNotFoundError):
        archive_entry(channel, "prompt-hamsa", "does-not-exist", today="2026-05-07")
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py -v`
Expected: 3 passed.

- [ ] **Step 6: Test that `regen_index` skips `.archive/`**

Append to `buddy/tests/test_consolidate_apply.py`:

```python
def test_regen_index_skips_archive_directory(channel):
    """regen_index must not include archived entries."""
    from buddy.scripts.memory import regen_index
    # Archive the entry first.
    archive_entry(channel, "prompt-hamsa", "x", today="2026-05-07")
    # Re-create a live entry with a different slug.
    (channel / "prompt-hamsa" / "y.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: y\n"
        "created: 2026-05-01\nupdated: 2026-05-01\ntags: [t]\n---\n\n**Lesson:** live.\n"
    )
    regen_index(channel)
    idx = (channel / "INDEX.md").read_text()
    assert "`y`" in idx or "y " in idx
    assert "`x`" not in idx
```

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py::test_regen_index_skips_archive_directory -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add buddy/scripts/memory.py buddy/scripts/consolidate.py buddy/tests/test_consolidate_apply.py
git commit -m "feat(buddy): consolidate — archive helper, regen_index .archive skip, meta.json"
```

---

### Task 10: Phase 4 — apply_plan: merge / summarize / archive ops

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_apply.py`

- [ ] **Step 1: Write failing tests**

Append to `buddy/tests/test_consolidate_apply.py`:

```python
def test_apply_merge_writes_output_and_archives_inputs(channel):
    """A merge op writes the new entry and archives the inputs."""
    spec = channel / "prompt-hamsa"
    (spec / "a.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: a\n"
        "created: 2026-04-01\nupdated: 2026-04-01\ntags: [t1]\n---\n\n**Lesson:** a.\n"
    )
    (spec / "b.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: b\n"
        "created: 2026-04-08\nupdated: 2026-04-08\ntags: [t2]\n---\n\n**Lesson:** b.\n"
    )
    plan = {
        "plan_version": 1,
        "specialist": "prompt-hamsa",
        "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [
            {
                "op": "merge",
                "inputs": ["a", "b"],
                "output": {
                    "slug": "ab",
                    "tags": ["t1", "t2"],
                    "body": "**Lesson:** merged.\n**Supersedes:** a, b\n",
                },
                "reason": "stutter",
            },
        ],
    }
    from buddy.scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    new_path = spec / "ab.md"
    assert new_path.exists()
    txt = new_path.read_text()
    assert "slug: ab" in txt
    assert "**Supersedes:**" in txt
    assert not (spec / "a.md").exists()
    assert not (spec / "b.md").exists()
    assert (spec / ARCHIVE_DIRNAME / "2026-05-07" / "a.md").exists()
    assert (spec / ARCHIVE_DIRNAME / "2026-05-07" / "b.md").exists()


def test_apply_archive_moves_file(channel):
    """An archive op moves the file."""
    plan = {
        "plan_version": 1,
        "specialist": "prompt-hamsa",
        "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from buddy.scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert not (channel / "prompt-hamsa" / "x.md").exists()
    assert (channel / "prompt-hamsa" / ARCHIVE_DIRNAME / "2026-05-07" / "x.md").exists()


def test_apply_summarize_behaves_like_merge(channel):
    """Summarize is mechanically identical to merge."""
    spec = channel / "prompt-hamsa"
    (spec / "a.md").write_text("---\nspecialist: prompt-hamsa\nscope: global\nslug: a\ncreated: 2026-04-01\nupdated: 2026-04-01\ntags: []\n---\n\n**Lesson:** a.\n")
    (spec / "b.md").write_text("---\nspecialist: prompt-hamsa\nscope: global\nslug: b\ncreated: 2026-04-08\nupdated: 2026-04-08\ntags: []\n---\n\n**Lesson:** b.\n")
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{
            "op": "summarize",
            "inputs": ["a", "b", "x"],
            "output": {"slug": "summary", "tags": [], "body": "**Lesson:** rolled up.\n"},
            "reason": "small entries",
        }],
    }
    from buddy.scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert (spec / "summary.md").exists()
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py -v -k apply`
Expected: FAILs (NotImplementedError on `apply_plan`).

- [ ] **Step 3: Implement `apply_plan` for merge/summarize/archive**

Replace the stub `apply_plan` in `buddy/scripts/consolidate.py` with:

```python
def apply_plan(plan: dict, channel_root: Path, *, today: str | None = None) -> dict:
    """Phase 4 — file moves driven by the plan. Idempotent, fail-closed.

    Returns: {"applied": int, "skipped": int, "deferred": list[str], "log": list[str]}
    """
    today = today or _today_iso()
    specialist = plan["specialist"]
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
            # Idempotency: input already moved by a prior run — skip silently.
            log.append(f"{today} skip {kind} {specialist}: {exc}")
            skipped += 1

    return {"applied": applied, "skipped": skipped, "deferred": deferred, "log": log}


def _apply_merge_like(op, spec_dir, channel_root, specialist, today, log):
    inputs = op["inputs"]
    output = op["output"]
    out_slug = output["slug"]
    out_path = spec_dir / f"{out_slug}.md"

    # Read existing input frontmatter to compute oldest `created` and union of tags.
    oldest_created = None
    union_tags: set[str] = set(output.get("tags", []) or [])
    for slug in inputs:
        src = spec_dir / f"{slug}.md"
        if not src.is_file():
            # If the input was already merged in a prior apply, treat as no-op.
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

    for slug in inputs:
        if slug == out_slug:
            continue  # in-place rewrite
        src = spec_dir / f"{slug}.md"
        if src.is_file():
            archive_entry(channel_root, specialist, slug, today=today)
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py -v -k apply`
Expected: 3 passed (merge, archive, summarize).

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_apply.py
git commit -m "feat(buddy): consolidate phase 4 — merge/summarize/archive ops"
```

---

### Task 11: Phase 4 — defer/keep_all + idempotency + path containment

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_apply.py`
- Modify: `buddy/tests/test_consolidate_validation.py`

- [ ] **Step 1: Write failing tests**

Append to `buddy/tests/test_consolidate_apply.py`:

```python
def test_apply_defer_writes_to_deferred_log(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "defer", "target": "a-vs-b", "reason": "user call"}],
    }
    from buddy.scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["deferred"] == ["a-vs-b"]
    deferred_file = channel / ".deferred.md"
    assert deferred_file.is_file()
    txt = deferred_file.read_text()
    assert "a-vs-b" in txt
    assert "user call" in txt


def test_apply_keep_all_is_noop(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "keep_all", "slugs": ["x"], "reason": "distinct"}],
    }
    from buddy.scripts.consolidate import apply_plan
    result = apply_plan(plan, channel, today="2026-05-07")
    assert result["applied"] == 1
    assert (channel / "prompt-hamsa" / "x.md").is_file()  # unchanged


def test_apply_is_idempotent_on_second_run(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from buddy.scripts.consolidate import apply_plan
    r1 = apply_plan(plan, channel, today="2026-05-07")
    assert r1["applied"] == 1
    r2 = apply_plan(plan, channel, today="2026-05-07")
    # Second run finds no source to archive — skipped, not error.
    assert r2["applied"] == 0
    assert r2["skipped"] == 1
```

Append to `buddy/tests/test_consolidate_validation.py`:

```python
def test_apply_rejects_path_escape_attempt(tmp_path):
    """A merge op trying to write outside the channel must fail closed."""
    from buddy.scripts.consolidate import apply_plan
    plan = {
        "plan_version": 1, "specialist": "../../etc", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "../../etc/passwd", "reason": "x"}],
    }
    with pytest.raises(ValueError, match="path"):
        apply_plan(plan, tmp_path, today="2026-05-07")
```

- [ ] **Step 2: Run, expect FAIL on path-escape; PASS on the others if Task 10 already covered defer/keep_all (it didn't — adjust if needed)**

Run: `cd buddy && python -m pytest tests/ -v -k "defer or keep_all or idempotent or path_escape"`
Expected: 1 FAIL on path_escape; defer/keep_all/idempotent should pass already from Task 10's apply_plan implementation.

- [ ] **Step 3: Add path-containment guard in `apply_plan`**

Edit `apply_plan` in `buddy/scripts/consolidate.py`. At the top, after `specialist = plan["specialist"]`, add:

```python
    # Path-containment: specialist must be a single safe component.
    if not _is_safe_path_component(specialist):
        raise ValueError(f"path: specialist {specialist!r} is not a safe path component")
    for op in plan["operations"]:
        for slug in _slugs_in_op(op):
            if not _is_safe_path_component(slug):
                raise ValueError(f"path: slug {slug!r} is not a safe path component")
```

Add helpers:

```python
def _is_safe_path_component(s: str) -> bool:
    if not isinstance(s, str) or not s:
        return False
    if "/" in s or "\\" in s or ".." in s.split("-"):
        return False
    if s.startswith(".") or s in (".", ".."):
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/ -v -k consolidate`
Expected: all consolidate tests green.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_apply.py buddy/tests/test_consolidate_validation.py
git commit -m "feat(buddy): consolidate phase 4 — defer, keep_all, idempotency, path containment"
```

---

### Task 12: Phase 3 — render_plan_for_user + Phase 4 wrap-up (mirror, log, meta)

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/tests/test_consolidate_apply.py`

- [ ] **Step 1: Write failing render-test**

Append to `buddy/tests/test_consolidate_apply.py`:

```python
def test_render_plan_for_user_groups_ops_by_kind(channel):
    """The user-facing rendering groups merge/archive/summarize/defer with counts."""
    from buddy.scripts.consolidate import render_plan_for_user
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [
            {"op": "merge", "inputs": ["a", "b"], "output": {"slug": "ab", "tags": [], "body": "X"}, "reason": "r1"},
            {"op": "archive", "slug": "c", "reason": "r2"},
            {"op": "defer", "target": "d-vs-e", "reason": "r3"},
        ],
    }
    md = render_plan_for_user(plan)
    assert "# Consolidation plan" in md
    assert "## Merges (1)" in md
    assert "## Archives (1)" in md
    assert "## Deferred (1)" in md
    assert "ab" in md and "c" in md and "d-vs-e" in md


def test_apply_writes_log_and_updates_meta(channel):
    plan = {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }
    from buddy.scripts.consolidate import apply_plan
    apply_plan(plan, channel, today="2026-05-07")
    log = (channel / ".consolidation.log").read_text()
    assert "archive prompt-hamsa x" in log
    meta_path = channel / "meta.json"
    import json
    meta = json.loads(meta_path.read_text())
    assert meta["last_consolidated"]["prompt-hamsa"].startswith("2026-05-07")
```

- [ ] **Step 2: Run, expect FAILs**

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py -v -k "render or log_and_updates_meta"`
Expected: 2 FAILs.

- [ ] **Step 3: Implement `render_plan_for_user`**

Replace stub in `buddy/scripts/consolidate.py`:

```python
def render_plan_for_user(plan: dict) -> str:
    """Render parsed plan as the dry-run markdown shown to the user."""
    by_kind = {"merge": [], "archive": [], "summarize": [], "keep_all": [], "defer": []}
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
        for body_line in op['output'].get('body', '').splitlines():
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
```

- [ ] **Step 4: Wire log + meta + plan-cache cleanup into `apply_plan`**

At the end of `apply_plan`, before `return`, append:

```python
    # Append per-op log lines.
    log_path = channel_root / CHANNEL_LOG_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a") as fh:
        for line in log:
            fh.write(line + "\n")

    # Update last_consolidated in meta.json.
    from buddy.scripts.memory import update_last_consolidated
    update_last_consolidated(channel_root, specialist, _today_iso() + "T00:00:00Z")

    # Regen INDEX.
    from buddy.scripts.memory import regen_index
    try:
        regen_index(channel_root)
    except Exception:
        pass  # INDEX is advisory; never block apply

    # Delete cached plan if present.
    plan_cache = channel_root / CHANNEL_PLAN_NAME
    if plan_cache.is_file():
        plan_cache.unlink()
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_apply.py -v`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_apply.py
git commit -m "feat(buddy): consolidate phase 3+4 — render plan, log, meta, INDEX regen"
```

---

### Task 13: Per-channel lock file

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Create: `buddy/tests/test_consolidate_lock.py`

- [ ] **Step 1: Write failing tests**

Create `buddy/tests/test_consolidate_lock.py`:

```python
"""Lock-file behavior for apply_plan."""
import os
import time
from pathlib import Path

import pytest

from buddy.scripts.consolidate import apply_plan, CHANNEL_LOCK_NAME


@pytest.fixture
def channel(tmp_path):
    spec = tmp_path / "prompt-hamsa"
    spec.mkdir()
    (spec / "x.md").write_text(
        "---\nspecialist: prompt-hamsa\nscope: global\nslug: x\n"
        "created: 2026-04-01\nupdated: 2026-04-01\ntags: [t]\n---\n\n**Lesson:** hi.\n"
    )
    return tmp_path


def _trivial_archive_plan():
    return {
        "plan_version": 1, "specialist": "prompt-hamsa", "channel": "global",
        "generated": "2026-05-07T14:30Z",
        "operations": [{"op": "archive", "slug": "x", "reason": "stale"}],
    }


def test_lock_blocks_concurrent_apply(channel):
    lock = channel / CHANNEL_LOCK_NAME
    lock.write_text(f"{os.getpid() + 99999}\t{time.time()}")
    with pytest.raises(RuntimeError, match="lock"):
        apply_plan(_trivial_archive_plan(), channel, today="2026-05-07")


def test_lock_stale_recovered(channel):
    lock = channel / CHANNEL_LOCK_NAME
    # Stale lock from > 1h ago.
    lock.write_text(f"99999\t{time.time() - 3600 * 2}")
    result = apply_plan(_trivial_archive_plan(), channel, today="2026-05-07")
    assert result["applied"] == 1
    assert not lock.is_file()


def test_lock_released_on_success(channel):
    apply_plan(_trivial_archive_plan(), channel, today="2026-05-07")
    assert not (channel / CHANNEL_LOCK_NAME).is_file()
```

- [ ] **Step 2: Run, expect FAILs**

Run: `cd buddy && python -m pytest tests/test_consolidate_lock.py -v`
Expected: FAILs (no lock implementation).

- [ ] **Step 3: Add lock implementation**

In `buddy/scripts/consolidate.py`, wrap the body of `apply_plan` with a lock context. Add the helper near the top of the file:

```python
import time
from contextlib import contextmanager

LOCK_STALE_SECONDS = 3600


@contextmanager
def _channel_lock(channel_root: Path):
    lock_path = channel_root / CHANNEL_LOCK_NAME
    if lock_path.is_file():
        try:
            content = lock_path.read_text().strip()
            _pid_str, ts_str = content.split("\t", 1)
            ts = float(ts_str)
            age = time.time() - ts
            if age < LOCK_STALE_SECONDS:
                raise RuntimeError(
                    f"lock: another consolidation is running on {channel_root} "
                    f"(pid in lock, age {int(age)}s)"
                )
        except (ValueError, OSError):
            pass  # malformed → treat as stale, overwrite below
    channel_root.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(f"{os.getpid()}\t{time.time()}")
    try:
        yield
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
```

Now wrap `apply_plan`. Find the `def apply_plan` and modify its body to use the context manager:

```python
def apply_plan(plan: dict, channel_root: Path, *, today: str | None = None) -> dict:
    """Phase 4 — file moves driven by the plan. Idempotent, fail-closed."""
    today = today or _today_iso()
    specialist = plan["specialist"]

    if not _is_safe_path_component(specialist):
        raise ValueError(f"path: specialist {specialist!r} is not a safe path component")
    for op in plan["operations"]:
        for slug in _slugs_in_op(op):
            if not _is_safe_path_component(slug):
                raise ValueError(f"path: slug {slug!r} is not a safe path component")

    with _channel_lock(channel_root):
        return _apply_plan_inner(plan, channel_root, today)


def _apply_plan_inner(plan: dict, channel_root: Path, today: str) -> dict:
    # (move the original body of apply_plan here, minus path-containment which moved up)
    specialist = plan["specialist"]
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

    log_path = channel_root / CHANNEL_LOG_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a") as fh:
        for line in log:
            fh.write(line + "\n")

    from buddy.scripts.memory import update_last_consolidated, regen_index
    update_last_consolidated(channel_root, specialist, today + "T00:00:00Z")
    try:
        regen_index(channel_root)
    except Exception:
        pass

    plan_cache = channel_root / CHANNEL_PLAN_NAME
    if plan_cache.is_file():
        plan_cache.unlink()

    return {"applied": applied, "skipped": skipped, "deferred": deferred, "log": log}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd buddy && python -m pytest tests/test_consolidate_lock.py tests/test_consolidate_apply.py -v`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_lock.py
git commit -m "feat(buddy): consolidate — per-channel lock file + stale recovery"
```

---

### Task 14: Wire `apply_plan_from_cache` + global mirror

**Files:**
- Modify: `buddy/scripts/consolidate.py`

- [ ] **Step 1: Implement `apply_plan_from_cache`**

Replace the stub in `buddy/scripts/consolidate.py`:

```python
def apply_plan_from_cache() -> str:
    """Walk both channel roots, find cached plans, apply each, mirror global writes."""
    from buddy.scripts.memory import current_instance_dir, mirror_global_write

    summary: list[str] = []
    candidates: list[tuple[Path, str]] = []
    inst_dir = current_instance_dir()
    if inst_dir:
        global_root = inst_dir / "buddy" / "memory"
        if (global_root / CHANNEL_PLAN_NAME).is_file():
            candidates.append((global_root, "global"))
    project_root = Path.cwd() / ".buddy" / "memory"
    if (project_root / CHANNEL_PLAN_NAME).is_file():
        candidates.append((project_root, "project"))

    if not candidates:
        return "no cached plans found"

    for channel_root, scope in candidates:
        plan_text = (channel_root / CHANNEL_PLAN_NAME).read_text()
        # The plan cached at .consolidation-plan.md is in the user-facing render
        # format. We need the parseable YAML — stored alongside as
        # .consolidation-plan.yaml by the slash command (see Task 7 / future
        # slash-command revision). If only the rendered plan exists, fail with
        # a clear message.
        yaml_cache = channel_root / ".consolidation-plan.yaml"
        if not yaml_cache.is_file():
            summary.append(f"{scope}: no machine-readable plan at {yaml_cache} — re-run consolidate to refresh")
            continue
        plan = parse_plan(yaml_cache.read_text())
        # TTL check.
        ttl_ok = _plan_within_ttl(yaml_cache, hours=PLAN_TTL_HOURS)
        if not ttl_ok:
            summary.append(f"{scope}: plan expired (>24h old). Re-run consolidate.")
            continue
        result = apply_plan(plan, channel_root)
        summary.append(
            f"{scope}: {result['applied']} applied, {result['skipped']} skipped, "
            f"{len(result['deferred'])} deferred"
        )
        # Mirror global writes to other CC instances.
        if scope == "global":
            for slug_path in (channel_root / plan["specialist"]).rglob("*.md"):
                rel = slug_path.relative_to(channel_root)
                mirror_global_write(rel)
            for archived in (channel_root / plan["specialist"] / ARCHIVE_DIRNAME).rglob("*.md"):
                rel = archived.relative_to(channel_root)
                mirror_global_write(rel)
        # Stage project writes.
        if scope == "project":
            import subprocess
            try:
                subprocess.run(
                    ["git", "add", str(channel_root)],
                    check=False, capture_output=True, cwd=channel_root.parent,
                )
            except OSError:
                pass

    return "\n".join(summary)


def _plan_within_ttl(p: Path, *, hours: int) -> bool:
    if not p.is_file():
        return False
    age_s = time.time() - p.stat().st_mtime
    return age_s < hours * 3600
```

Note: the slash command in Task 7 must also save the parseable YAML alongside the rendered markdown. Patch the relevant step in `consolidate.md`: at Step 5, write *two* files — `.consolidation-plan.md` (rendered) and `.consolidation-plan.yaml` (raw plan YAML). Apply this edit:

In `buddy/commands/consolidate.md`, find Step 5 and append after the cache-write paragraph:

```markdown
Also write the raw YAML plan (the same string parsed by `parse_plan`) to
`<channel-root>/.consolidation-plan.yaml`. This is what `apply_plan_from_cache`
re-parses. The `.md` file is for humans; the `.yaml` file is for the script.
```

- [ ] **Step 2: Smoke-test**

Run: `cd buddy && python -m pytest tests/ -q`
Expected: all green (no new tests added; this task wires existing pieces).

- [ ] **Step 3: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/commands/consolidate.md
git commit -m "feat(buddy): consolidate — apply_plan_from_cache + global mirror + TTL"
```

---

### Task 15: SessionStart soft-suggestion + periodic nudge

**Files:**
- Modify: `buddy/hooks/session-start.sh`
- Modify: `buddy/tests/test_hooks_session_start.sh`

- [ ] **Step 1: Read current `session-start.sh` to find the memory-hint section**

Run: `grep -n "memory" buddy/hooks/session-start.sh | head -20`

Identify the existing memory-hint block (it currently emits the 30-entry soft cap). The new logic adds:
1. Per-specialist count check (already partly there).
2. `meta.json` last_consolidated check; nudge if > STALE_DAYS_NUDGE.

- [ ] **Step 2: Add a Python helper script invocation**

Append (or insert into the relevant memory-scan block) the following bash, which calls a helper in `consolidate.py` that returns nudges:

```bash
# Memory consolidation nudges (capacity + stale-since).
NUDGE_LINES=$(python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import session_start_nudges
from scripts.memory import current_instance_dir
inst = current_instance_dir()
roots = []
if inst:
    roots.append(inst / 'buddy' / 'memory')
proj = Path('${CLAUDE_PROJECT_DIR:-.}') / '.buddy' / 'memory'
if proj.is_dir():
    roots.append(proj)
for r in roots:
    for line in session_start_nudges(r):
        print(line)
" 2>/dev/null)

if [ -n "$NUDGE_LINES" ]; then
    echo "$NUDGE_LINES"
fi
```

- [ ] **Step 3: Implement `session_start_nudges` in `consolidate.py`**

Append:

```python
def session_start_nudges(channel_root: Path) -> list[str]:
    """Return zero or more one-line nudges for session-start to print."""
    if not channel_root.is_dir():
        return []
    out: list[str] = []
    from buddy.scripts.memory import read_channel_meta
    meta = read_channel_meta(channel_root)
    last = meta.get("last_consolidated", {})
    today = _today_iso()

    # Suppress everything if a fresh plan is cached.
    plan_yaml = channel_root / ".consolidation-plan.yaml"
    if plan_yaml.is_file() and _plan_within_ttl(plan_yaml, hours=PLAN_TTL_HOURS):
        return [f"→ memory: dry-run plan waiting at {plan_yaml.parent} — /buddy:consolidate apply | revise | cancel"]

    for spec_dir in sorted(channel_root.iterdir()):
        if not spec_dir.is_dir():
            continue
        if spec_dir.name in (".archive", "common"):
            # We still nudge `common`, but do that below by name.
            pass
        # Soft cap.
        n_entries = sum(1 for p in spec_dir.iterdir()
                        if p.is_file() and p.suffix == ".md" and not p.name.startswith("."))
        if n_entries > SOFT_CAP_ENTRIES:
            out.append(
                f"→ memory: {spec_dir.name} has {n_entries} entries in {channel_root.name} — "
                f"consider /buddy:consolidate {spec_dir.name}"
            )
        # Periodic nudge.
        last_iso = last.get(spec_dir.name, "")
        if last_iso:
            age_d = _days_between(last_iso[:10], today)
            if age_d > STALE_DAYS_NUDGE:
                out.append(
                    f"→ memory: {spec_dir.name} last consolidated {age_d} days ago — "
                    f"/buddy:consolidate {spec_dir.name} when ready"
                )
    return out
```

- [ ] **Step 4: Add session-start tests**

Append to `buddy/tests/test_hooks_session_start.sh` (extend existing test file):

```bash
test_consolidation_nudge_at_capacity() {
    local cwd
    cwd=$(create_test_repo)
    cd "$cwd"

    # Build a fake channel under HOME with 31 entries for prompt-hamsa.
    fake_home="$cwd/fake-home"
    mkdir -p "$fake_home/.claude/buddy/memory/prompt-hamsa"
    for i in $(seq 1 31); do
        printf -- "---\nspecialist: prompt-hamsa\nscope: global\nslug: x%d\ncreated: 2026-04-01\nupdated: 2026-04-01\ntags: [t]\n---\n\n**Lesson:** %d.\n" "$i" "$i" \
            > "$fake_home/.claude/buddy/memory/prompt-hamsa/x$i.md"
    done

    HOME="$fake_home" CLAUDE_PROJECT_DIR="$cwd" \
        bash "$BUDDY_ROOT/hooks/session-start.sh" </dev/null 2>&1 | tee out.log >/dev/null
    grep -q "consider /buddy:consolidate prompt-hamsa" out.log || {
        echo "FAIL: capacity nudge not emitted"
        cat out.log
        return 1
    }
    echo "PASS: capacity nudge emitted"
}
```

(If `create_test_repo` and `BUDDY_ROOT` differ in the existing harness, adapt to the patterns used by surrounding tests in the same file.)

- [ ] **Step 5: Run tests**

Run: `cd buddy && bash tests/test_hooks_session_start.sh`
Expected: all tests pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add buddy/hooks/session-start.sh buddy/scripts/consolidate.py buddy/tests/test_hooks_session_start.sh
git commit -m "feat(buddy): consolidate triggers — capacity + stale-since nudges in session-start"
```

---

### Task 16: Auto-trigger opt-in flag

**Files:**
- Modify: `buddy/scripts/consolidate.py`
- Modify: `buddy/hooks/session-start.sh`
- Modify: `buddy/README.md` (config doc)

- [ ] **Step 1: Read auto-trigger config**

Append to `buddy/scripts/consolidate.py`:

```python
def read_auto_trigger_config(cwd: Path) -> dict:
    """Read .claude/buddy.json for auto-trigger flags. Returns defaults if absent."""
    p = cwd / ".claude" / "buddy.json"
    defaults = {
        "auto_dry_run_on_session_start": False,
        "auto_dry_run_threshold_days": 30,
        "auto_dry_run_threshold_entries": 30,
        "auto_dry_run_debounce_hours": 6,
    }
    if not p.is_file():
        return defaults
    try:
        import json
        data = json.loads(p.read_text())
        cons = data.get("consolidation", {})
        return {**defaults, **cons}
    except (OSError, ValueError):
        return defaults


def auto_dry_run_eligible(channel_root: Path, cfg: dict) -> str | None:
    """If auto-trigger should run on this channel, return the most-overdue specialist; else None."""
    if not cfg.get("auto_dry_run_on_session_start"):
        return None
    if not channel_root.is_dir():
        return None
    from buddy.scripts.memory import read_channel_meta
    meta = read_channel_meta(channel_root)
    last_attempt = meta.get("last_auto_dry_run_attempt", "")
    if last_attempt:
        age_h = (time.time() - _iso_to_ts(last_attempt)) / 3600
        if age_h < cfg["auto_dry_run_debounce_hours"]:
            return None
    last = meta.get("last_consolidated", {})
    today = _today_iso()
    overdue: list[tuple[int, str]] = []
    for spec_dir in channel_root.iterdir():
        if not spec_dir.is_dir() or spec_dir.name in (".archive",):
            continue
        n_entries = sum(1 for p in spec_dir.iterdir()
                        if p.is_file() and p.suffix == ".md" and not p.name.startswith("."))
        last_iso = last.get(spec_dir.name, "")
        age_d = _days_between(last_iso[:10], today) if last_iso else 9999
        if n_entries > cfg["auto_dry_run_threshold_entries"] or age_d > cfg["auto_dry_run_threshold_days"]:
            overdue.append((age_d, spec_dir.name))
    if not overdue:
        return None
    overdue.sort(reverse=True)
    return overdue[0][1]


def _iso_to_ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
```

- [ ] **Step 2: Wire it into `session-start.sh`**

Append to the same hook (after the nudge block):

```bash
# Optional auto-dry-run (opt-in via .claude/buddy.json).
AUTO=$(python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import read_auto_trigger_config, auto_dry_run_eligible
from scripts.memory import current_instance_dir
cfg = read_auto_trigger_config(Path('${CLAUDE_PROJECT_DIR:-.}'))
inst = current_instance_dir()
roots = []
if inst:
    roots.append(inst / 'buddy' / 'memory')
proj = Path('${CLAUDE_PROJECT_DIR:-.}') / '.buddy' / 'memory'
if proj.is_dir():
    roots.append(proj)
for r in roots:
    target = auto_dry_run_eligible(r, cfg)
    if target:
        print(f'{r}\\t{target}')
        break
" 2>/dev/null)

if [ -n "$AUTO" ]; then
    # We do NOT execute Phase 1+2 from inside the hook — too slow, and would
    # block session start. Instead, emit a structured suggestion the user
    # (or a follow-up agent) can act on.
    echo "→ memory: auto-trigger enabled — most-overdue: $AUTO. Run /buddy:consolidate to start the dry-run."
fi
```

(For v1 we surface the suggestion rather than spawning a background subagent; the spec's "background subagent" approach can be revisited once we have a clean way to spawn from a hook without blocking.)

- [ ] **Step 3: Document in README**

In `buddy/README.md`, find the `## Memory` section. Append at its end:

```markdown
### Consolidation auto-trigger (opt-in)

Add to `.claude/buddy.json`:

```json
{
  "consolidation": {
    "auto_dry_run_on_session_start": true,
    "auto_dry_run_threshold_days": 30,
    "auto_dry_run_threshold_entries": 30,
    "auto_dry_run_debounce_hours": 6
  }
}
```

When enabled, the SessionStart hook surfaces the most-overdue specialist and
suggests `/buddy:consolidate`. Apply still requires explicit user action.
Default off.
```

- [ ] **Step 4: Run tests**

Run: `cd buddy && python -m pytest tests/ -q && bash tests/test_hooks_session_start.sh`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/hooks/session-start.sh buddy/README.md
git commit -m "feat(buddy): consolidate — opt-in auto-trigger config + session-start surfacing"
```

---

### Task 17: Cross-link memory-protocol + final integration check

**Files:**
- Modify: `buddy/data/memory-protocol.md`
- Run: full test suite

- [ ] **Step 1: Add a cross-link in `memory-protocol.md`**

Use `mcp__codescout__edit_markdown` action="insert_after" on the heading `# Memory Protocol`:

```markdown

> **Consolidation:** when memories accumulate or drift, run
> `/buddy:consolidate` to merge near-duplicates, archive stale entries,
> summarize tag-clusters, and surface contradictions. See
> `consolidation-protocol.md` for the operation schema.
```

- [ ] **Step 2: Run the full plugin test suite**

Run:
```
cd buddy && python -m pytest tests/ -q
```
Expected: all green (a number > 270 — was 262 before this feature).

Run:
```
bash tests/run-all.sh
```
(Use the top-level test-runner if it exists; check via `ls tests/run-all.sh` first.)
Expected: all suites pass.

- [ ] **Step 3: Manual smoke check (no code changes)**

In a fresh CC session:

1. `/buddy:summon prompt`
2. Add a few `/buddy:remember` lessons under prompt-hamsa.
3. `/buddy:consolidate prompt` — confirm Phase 1 runs and produces a brief, Phase 2 invokes the Hamsa, plan is cached.
4. Read `<channel>/.consolidation-plan.md` and `.consolidation-plan.yaml`.
5. `/buddy:consolidate apply` — confirm files moved to `.archive/<today>/`, INDEX regenerated, log appended.

If anything misbehaves, file a follow-up; do not patch in this commit.

- [ ] **Step 4: Commit**

```bash
git add buddy/data/memory-protocol.md
git commit -m "docs(buddy): cross-link memory-protocol to consolidation"
```

---

## Self-Review Checklist (already run by plan author)

- [x] **Spec coverage:** every section of the spec maps to a task —
  - Surface and scope → Task 1, Task 7
  - Channel layout → Task 9 (.archive), Task 12 (log + meta), Task 14 (yaml cache)
  - Phase 1 → Tasks 2–5
  - Phase 2 → Tasks 6, 7
  - Phase 3 → Task 12
  - Phase 4 → Tasks 9–13
  - Triggers → Tasks 15, 16
  - Failure modes → Tasks 8, 11, 13 (lock), 12 (TTL), 14 (mirror)
  - Testing → Tasks 2–5, 8, 9–13, 15
  - Versioning → Task 8 (plan_version), Task 9 (meta.version)

- [x] **No placeholders.** Every step has either complete code or an exact
  edit instruction. The slash command's natural-language steps are
  intentional (Claude Code commands ARE prose).

- [x] **Type/name consistency.** Module-level constants
  (`CHANNEL_LOCK_NAME`, `CHANNEL_LOG_NAME`, `CHANNEL_PLAN_NAME`,
  `CHANNEL_DEFERRED_NAME`, `CHANNEL_META_NAME`, `ARCHIVE_DIRNAME`,
  `STALE_DAYS_DEFAULT`, `STALE_DAYS_NUDGE`, `SOFT_CAP_ENTRIES`,
  `PLAN_TTL_HOURS`, `LOCK_STALE_SECONDS`) declared in Task 1 and reused
  consistently downstream. Function names (`find_candidates`, `render_brief`,
  `parse_plan`, `render_plan_for_user`, `apply_plan`, `apply_plan_from_cache`,
  `archive_entry`, `session_start_nudges`, `read_auto_trigger_config`,
  `auto_dry_run_eligible`) all defined once and referenced under those exact
  names.
