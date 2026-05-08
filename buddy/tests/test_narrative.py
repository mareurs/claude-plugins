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



def test_enforce_cap_noop_when_under_limit(tmp_path):
    from scripts.narrative import (
        append_entry,
        enforce_narrative_cap,
        read_narrative,
    )
    path = tmp_path / "narrative.jsonl"
    for i in range(10):
        append_entry(path, "action", f"entry-{i}")
    truncated = enforce_narrative_cap(path)
    assert truncated is False
    assert len(read_narrative(path)) == 10


def test_enforce_cap_truncates_to_keep_recent_when_over_entry_cap(tmp_path):
    from scripts.narrative import (
        MAX_ENTRIES_HARD_CAP,
        KEEP_RECENT,
        append_entry,
        enforce_narrative_cap,
        read_narrative,
    )
    path = tmp_path / "narrative.jsonl"
    # Write exactly MAX_ENTRIES_HARD_CAP + 1 so truncation fires on the last
    # append and no further writes accumulate after it. (append_entry calls
    # enforce_narrative_cap on every write, so adding more entries beyond the
    # truncation point would just grow the post-truncation tail.)
    for i in range(MAX_ENTRIES_HARD_CAP + 1):
        append_entry(path, "action", f"entry-{i}")
    enforce_narrative_cap(path)  # idempotent
    entries = read_narrative(path)
    assert len(entries) == KEEP_RECENT + 1, (
        f"expected KEEP_RECENT ({KEEP_RECENT}) recent entries + 1 truncation "
        f"placeholder, got {len(entries)}"
    )
    assert entries[0]["type"] == "truncated", (
        "first entry should be the truncation placeholder"
    )
    assert "auto-truncated" in entries[0]["text"]
    last_text = entries[-1]["text"]
    assert last_text.startswith("entry-"), (
        "last entry should be a real action, got: " + last_text
    )


def test_enforce_cap_truncates_when_over_byte_cap(tmp_path, monkeypatch):
    import scripts.narrative as nar
    # Drop the byte cap so we can trigger it without writing a real megabyte.
    monkeypatch.setattr(nar, "MAX_BYTES_HARD_CAP", 200)
    monkeypatch.setattr(nar, "MAX_ENTRIES_HARD_CAP", 10_000)  # disable entry-cap path
    path = tmp_path / "narrative.jsonl"
    # Each entry is ~50 bytes; 20 entries blow the 200-byte cap.
    for i in range(20):
        nar.append_entry(path, "action", f"entry-{i}")
    nar.enforce_narrative_cap(path)
    entries = nar.read_narrative(path)
    assert len(entries) <= nar.KEEP_RECENT + 1
    assert entries[0]["type"] == "truncated"


def test_append_entry_calls_enforce_cap(tmp_path, monkeypatch):
    import scripts.narrative as nar
    # Force the cap to engage after just a few entries to verify append_entry
    # invokes enforce_narrative_cap on every write.
    monkeypatch.setattr(nar, "MAX_ENTRIES_HARD_CAP", 5)
    path = tmp_path / "narrative.jsonl"
    for i in range(20):
        nar.append_entry(path, "action", f"entry-{i}")
    entries = nar.read_narrative(path)
    # Should not exceed KEEP_RECENT + 1 placeholder.
    assert len(entries) <= nar.KEEP_RECENT + 1, (
        f"append_entry should enforce cap on every write; got {len(entries)}"
    )
