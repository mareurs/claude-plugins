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
