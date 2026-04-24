"""Tests for scripts/cs_heuristics.py — deterministic pattern checkers."""
from scripts.cs_heuristics import check


def _make_event(tool_name="", tool_input=None, tool_error=None, cwd="/home/user/project"):
    return {
        "tool_name": tool_name,
        "tool_input": tool_input or {},
        "tool_error": tool_error,
        "timestamp": 1000,
        "cwd": cwd,
    }


def _make_log_entry(tool="", args="", outcome="ok", ts=1000):
    return {"ts": ts, "tool": tool, "args": args, "outcome": outcome}


# --- structural edit_file ---

def test_structural_edit_detected():
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={
            "path": "src/main.rs",
            "new_string": "fn foo() {\n    bar()\n}\n",
        },
    )
    result = check(event, [])
    assert result is not None
    assert "replace_symbol" in result
    assert "BUG-027" in result


def test_structural_edit_single_line_ok():
    """Single-line edits are fine — only multi-line triggers."""
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={
            "path": "src/main.rs",
            "new_string": "fn foo() { bar() }",
        },
    )
    result = check(event, [])
    assert result is None


def test_structural_edit_non_source_ok():
    """edit_file on non-source files is fine."""
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={
            "path": "README.md",
            "new_string": "def foo():\n    pass\n",
        },
    )
    result = check(event, [])
    assert result is None


def test_structural_edit_comment_no_keyword():
    """edit_file without definition keywords is fine."""
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={
            "path": "src/main.py",
            "new_string": "    x = 1\n    y = 2\n",
        },
    )
    result = check(event, [])
    assert result is None


# --- forgot restore ---

def test_forgot_restore_detected():
    log = [
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/other"),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/another"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__activate_project",
        tool_input={"path": "/another"},
    )
    result = check(event, log)
    assert result is not None
    assert "Iron Law 4" in result


def test_restore_after_foreign_ok():
    log = [
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/other"),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=."),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/new"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__activate_project",
        tool_input={"path": "/new"},
    )
    result = check(event, log)
    assert result is None


def test_first_foreign_activation_ok():
    """First foreign activation shouldn't trigger (no prior unrestored)."""
    log = [
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/first"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__activate_project",
        tool_input={"path": "/first"},
    )
    result = check(event, log)
    assert result is None


def test_restore_by_absolute_path_ok():
    """Activating home by absolute path (== cwd) is a restore, not foreign."""
    log = [
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/other"),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/home/me/project"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__activate_project",
        tool_input={"path": "/home/me/project"},
    )
    event["cwd"] = "/home/me/project"
    result = check(event, log)
    assert result is None


def test_restore_by_absolute_path_in_log_ok():
    """Prior log entry matching cwd counts as a restore."""
    log = [
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/foreign"),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/home/me/project"),
        _make_log_entry(tool="mcp__codescout__activate_project", args="path=/another"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__activate_project",
        tool_input={"path": "/another"},
    )
    event["cwd"] = "/home/me/project"
    result = check(event, log)
    assert result is None


# --- ignored buffer ref ---

def test_ignored_buffer_ref_detected():
    log = [
        _make_log_entry(tool="mcp__codescout__run_command", args="cargo test", outcome="buffered"),
        _make_log_entry(tool="mcp__codescout__list_symbols", args="path=src/"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__list_symbols",
        tool_input={"path": "src/"},
    )
    result = check(event, log)
    assert result is not None
    assert "@cmd_" in result


def test_buffer_ref_used_ok():
    log = [
        _make_log_entry(tool="mcp__codescout__run_command", args="cargo test", outcome="buffered"),
        _make_log_entry(tool="mcp__codescout__run_command", args="grep FAILED @cmd_abc"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__run_command",
        tool_input={"command": "grep FAILED @cmd_abc"},
    )
    result = check(event, log)
    assert result is None


def test_buffer_ref_grep_pattern_not_false_positive():
    """Grep command with @cmd_ in the *pattern* (not outcome) must not trigger."""
    log = [
        _make_log_entry(
            tool="mcp__codescout__run_command",
            args='grep -n "output_id\\|@cmd_" scripts/foo.py',
            outcome="ok",
        ),
        _make_log_entry(tool="mcp__codescout__run_command", args="ls scripts/"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__run_command",
        tool_input={"command": "ls scripts/"},
    )
    result = check(event, log)
    assert result is None, "grep pattern containing @cmd_ must not trigger buffer-ref hint"


# --- native bash on source ---

def test_native_bash_cat_detected():
    event = _make_event(
        tool_name="Bash",
        tool_input={"command": "cat src/main.rs"},
    )
    result = check(event, [])
    assert result is not None
    assert "read_file" in result or "find_symbol" in result


def test_native_bash_non_source_ok():
    event = _make_event(
        tool_name="Bash",
        tool_input={"command": "cat /tmp/output.txt"},
    )
    result = check(event, [])
    assert result is None


# --- parallel write ---

def test_parallel_write_detected():
    log = [
        _make_log_entry(tool="mcp__codescout__edit_file", ts=1000),
        _make_log_entry(tool="mcp__codescout__replace_symbol", ts=1000),
    ]
    event = _make_event(tool_name="mcp__codescout__replace_symbol")
    result = check(event, log)
    assert result is not None
    assert "BUG-021" in result


def test_sequential_writes_ok():
    log = [
        _make_log_entry(tool="mcp__codescout__edit_file", ts=1000),
        _make_log_entry(tool="mcp__codescout__replace_symbol", ts=1002),
    ]
    event = _make_event(tool_name="mcp__codescout__replace_symbol")
    result = check(event, log)
    assert result is None


# ── _check_grep_for_concept ────────────────────────────────────────────────

def test_grep_for_concept_detected():
    """Multi-word all-alpha phrase should suggest semantic_search."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "retry logic backoff"},
    )
    result = check(event, [])
    assert result is not None
    assert "semantic_search" in result


def test_grep_for_concept_two_words_detected():
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "authentication middleware"},
    )
    result = check(event, [])
    assert result is not None
    assert "semantic_search" in result


def test_grep_for_concept_regex_metachar_ok():
    """Pattern with regex metacharacters is a legitimate regex — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": r"fn handle_\w+"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_pipe_ok():
    """Pattern with | is a regex alternation — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "notification|push"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_short_ok():
    """Short patterns are literal lookups — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "pub fn"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_code_syntax_ok():
    """Pattern containing :: or -> is a code fragment — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "std::collections::HashMap"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_snake_case_ok():
    """Single snake_case identifier (contains __) — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__search_pattern",
        tool_input={"pattern": "derive_mood_from_signals"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_wrong_tool_ok():
    """Only fires for search_pattern, not other tools."""
    event = _make_event(
        tool_name="mcp__codescout__find_symbol",
        tool_input={"query": "authentication middleware"},
    )
    result = check(event, [])
    assert result is None


# --- check returns None on no issues ---

def test_no_issues():
    event = _make_event(
        tool_name="mcp__codescout__list_symbols",
        tool_input={"path": "src/"},
    )
    result = check(event, [])
    assert result is None


# --- check is exception-safe ---

def test_check_exception_safe():
    """check() must return None on any exception, never raise."""
    result = check(None, None)
    assert result is None
