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
