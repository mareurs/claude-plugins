"""Tests for the narrative append-only log."""
import json
import time
from pathlib import Path
from scripts.narrative import append_entry, read_narrative


def test_append_entry_creates_file(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "action", "Claude Edit scripts/state.py — added judge signals")
    assert path.exists()
    lines = path.read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["type"] == "action"
    assert entry["text"] == "Claude Edit scripts/state.py — added judge signals"
    assert "ts" in entry


def test_append_entry_appends_multiple(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "goal", "User wants to add PreToolUse hook")
    append_entry(path, "action", "Claude read hook_helpers.py")
    append_entry(path, "decision", "Using JSON for verdict storage")
    lines = path.read_text().strip().splitlines()
    assert len(lines) == 3
    assert json.loads(lines[0])["type"] == "goal"
    assert json.loads(lines[2])["type"] == "decision"


def test_read_narrative_returns_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "goal", "Fix login bug")
    append_entry(path, "action", "Claude read auth.py")
    entries = read_narrative(path)
    assert len(entries) == 2
    assert entries[0]["type"] == "goal"
    assert entries[1]["type"] == "action"


def test_read_narrative_empty_file(tmp_path):
    path = tmp_path / "narrative.jsonl"
    entries = read_narrative(path)
    assert entries == []


def test_read_narrative_missing_file(tmp_path):
    path = tmp_path / "does_not_exist.jsonl"
    entries = read_narrative(path)
    assert entries == []


def test_append_entry_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "deep" / "narrative.jsonl"
    append_entry(path, "action", "something")
    assert path.exists()


def test_append_entry_silent_on_failure():
    """Appending to an invalid path must not raise."""
    bad_path = Path("/proc/nonexistent/narrative.jsonl")
    append_entry(bad_path, "action", "should not crash")
    # No exception = pass


from scripts.narrative import compact_narrative, MAX_ENTRIES_BEFORE_COMPACT


def test_compact_replaces_old_entries_with_summary(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(60):
        append_entry(path, "action", f"Action {i}")
    assert len(read_narrative(path)) == 60

    compact_narrative(path, summary="Did 60 things in the first phase.")
    entries = read_narrative(path)
    # Should have 1 compact + the 10 most recent
    assert entries[0]["type"] == "compact"
    assert "60 things" in entries[0]["text"]
    assert len(entries) == 11


def test_compact_preserves_recent_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(55):
        append_entry(path, "action", f"Action {i}")
    compact_narrative(path, summary="Summary of old stuff.")
    entries = read_narrative(path)
    # Last entry should be the most recent action
    assert entries[-1]["text"] == "Action 54"


def test_compact_noop_when_few_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(10):
        append_entry(path, "action", f"Action {i}")
    compact_narrative(path, summary="Should not be written.")
    entries = read_narrative(path)
    assert len(entries) == 10
    assert all(e["type"] == "action" for e in entries)


def test_max_entries_before_compact_is_50():
    assert MAX_ENTRIES_BEFORE_COMPACT == 50
