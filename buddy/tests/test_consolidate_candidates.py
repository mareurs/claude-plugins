"""Unit tests for buddy.scripts.consolidate.find_candidates (Phase 1)."""
from pathlib import Path

import pytest

from scripts.consolidate import find_candidates

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



def test_stale_detects_entry_past_threshold(monkeypatch):
    """Entry with updated > 90 days ago AND no summon-log evidence post-update is stale."""
    monkeypatch.setattr(
        "scripts.consolidate._today_iso",
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
        "scripts.consolidate._today_iso",
        lambda: "2026-05-07",
    )
    cand = find_candidates(
        FIXTURES,
        "prompt-hamsa",
        summons_log_path=FIXTURES / "summons.log",
    )
    stale_slugs = {s["slug"] for s in cand["stale"]}
    assert "eval-rubric-design" not in stale_slugs  # updated 2026-04-01



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
    from scripts.consolidate import render_brief
    md = render_brief(cand)
    assert "## Slug-collision groups" in md
    assert "## Tag-overlap clusters" in md
    assert "## Stale" in md
    assert "## Contradictions" in md
    assert "## Orphans" in md
