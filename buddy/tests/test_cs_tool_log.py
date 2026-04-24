"""Tests for scripts/cs_tool_log.py — per-session codescout tool call log."""
import json

from scripts.cs_tool_log import append_entry, read_entries, summarize_args, MAX_ENTRIES


def test_append_creates_file(tmp_path):
    path = tmp_path / "cs_tool_log.jsonl"
    entries = append_entry(path, "mcp__codescout__list_symbols", "path=src/", "ok")
    assert path.exists()
    assert len(entries) == 1
    assert entries[0]["tool"] == "mcp__codescout__list_symbols"
    assert entries[0]["outcome"] == "ok"
    assert "ts" in entries[0]


def test_append_multiple(tmp_path):
    path = tmp_path / "cs_tool_log.jsonl"
    append_entry(path, "mcp__codescout__list_symbols", "path=src/", "ok")
    entries = append_entry(path, "mcp__codescout__find_symbol", "query=foo", "ok")
    assert len(entries) == 2


def test_read_entries_missing_file(tmp_path):
    path = tmp_path / "nonexistent.jsonl"
    assert read_entries(path) == []


def test_read_entries_corrupt_line(tmp_path):
    path = tmp_path / "cs_tool_log.jsonl"
    path.write_text('{"tool":"a"}\nnot json\n{"tool":"b"}\n')
    # read_entries should return empty on parse error (entire file fails)
    entries = read_entries(path)
    # Actually, the line-by-line read will fail on "not json" — our impl
    # wraps the whole thing in try/except, so it returns []
    assert entries == []


def test_cap_enforcement(tmp_path):
    path = tmp_path / "cs_tool_log.jsonl"
    for i in range(MAX_ENTRIES + 10):
        entries = append_entry(path, f"tool_{i}", f"args={i}", "ok")
    assert len(entries) == MAX_ENTRIES
    # Oldest entries should have been trimmed
    assert entries[0]["tool"] == f"tool_10"


def test_summarize_args_truncates_long_values():
    args = {"path": "a" * 200, "query": "short"}
    result = summarize_args(args)
    assert len(result) <= 200


def test_summarize_args_non_dict():
    assert len(summarize_args("just a string")) <= 100


def test_append_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "deep" / "cs_tool_log.jsonl"
    entries = append_entry(path, "tool", "args", "ok")
    assert path.exists()
    assert len(entries) == 1


def test_append_silent_on_failure():
    """Appending to an invalid path must not raise."""
    from pathlib import Path
    bad_path = Path("/proc/nonexistent/cs_tool_log.jsonl")
    result = append_entry(bad_path, "tool", "args", "ok")
    assert result == []
