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
def test_summarize_args_preserves_path_when_it_is_the_last_key():
    """KEY ORDER IS THE POINT OF THIS TEST — do not tidy it.

    `path` is written LAST here deliberately: that is the ordering under which the
    old blind `[:200]` tail cut mutilated it, yielding a well-formed prefix like
    `src/serve` that a consumer would happily match against disk. The pre-existing
    fixture put `path` FIRST — the one ordering where the bug cannot fire — and
    asserted only `len(result) <= 200`, which is equally satisfied by returning "",
    by dropping the path, or by cutting it mid-token.
    See docs/issues/archive/2026-09-01-summarize-args-destroys-the-path-it-documents-preserving.md
    """
    from scripts.cs_tool_log import summarize_args

    long = "x" * 300
    out = summarize_args({"new_string": long, "old_string": long, "path": "src/server.rs"})
    assert "path=src/server.rs" in out, f"path lost or truncated: {out!r}"


def test_summarize_args_protects_file_path_spelling_too():
    """Both spellings have downstream consumers; both must survive.

    Two long values precede `file_path` on purpose: the record must exceed the
    200-char budget BEFORE reaching it, or the test passes trivially without
    exercising any protection (it did, at first writing).
    """
    from scripts.cs_tool_log import summarize_args

    long = "y" * 300
    out = summarize_args(
        {"content": long, "old_string": long, "new_string": long,
         "file_path": "docs/a/very/deep/file.md"}
    )
    assert "file_path=docs/a/very/deep/file.md" in out, f"file_path lost: {out!r}"


def test_summarize_args_record_truncation_carries_a_marker():
    """A record-level cut must be distinguishable from a genuinely short record.

    The value-level cut always marked itself (`val[:77] + "..."`); the record-level
    cut did not, so `path=src/serve` was indistinguishable from a real short path.
    """
    from scripts.cs_tool_log import summarize_args

    cut = summarize_args({"path": "p.rs", "a": "A" * 90, "b": "B" * 90, "c": "C" * 90})
    assert len(cut) <= 200
    assert cut.endswith("..."), f"record cut left no marker: {cut!r}"

    whole = summarize_args({"path": "p.rs", "a": "A"})
    assert not whole.endswith("..."), \
        f"an untruncated record must not look truncated: {whole!r}"


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
