"""Lock-file behavior for apply_plan."""
import os
import time
from pathlib import Path

import pytest

from scripts.consolidate import apply_plan, CHANNEL_LOCK_NAME


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
