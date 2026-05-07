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
