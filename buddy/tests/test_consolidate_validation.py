"""Tests for plan parsing and validation."""
import pytest

from scripts.consolidate import parse_plan

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
