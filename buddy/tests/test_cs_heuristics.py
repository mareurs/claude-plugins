"""Tests for scripts/cs_heuristics.py — deterministic pattern checkers."""
import re

import pytest

from scripts.cs_heuristics import check
from scripts.cs_tool_log import summarize_args


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
def _activate_event(path, cwd="/home/user/project"):
    """A workspace(action="activate") call, as the PostToolUse hook receives it."""
    return _make_event(
        tool_name="mcp__codescout__workspace",
        tool_input={"action": "activate", "path": path},
        cwd=cwd,
    )


def _activate_entry(path):
    """The cs_tool_log record for that call. `args` comes from the real
    summarize_args, so the test cannot drift from the format the log writes."""
    return _make_log_entry(
        tool="mcp__codescout__workspace",
        args=summarize_args({"action": "activate", "path": path}),
    )


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
    assert "edit_code" in result
    assert "BUG-027" in result


@pytest.mark.parametrize("path,new_string", [
    ("src/main.go", "func main() {\n    run()\n}\n"),
    ("src/lib.rs", "trait Greeter {\n    // greets\n}\n"),
    ("src/app.py", "def handler(event):\n    return event\n"),
])
def test_structural_edit_detected_for_every_definition_keyword(path, new_string):
    """`func` (Go) and `trait` (Rust) are in the definition list, not only `fn`."""
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={"path": path, "new_string": new_string},
    )
    result = check(event, [])
    assert result is not None
    assert "edit_code" in result


def test_structural_edit_keyword_must_be_a_whole_word():
    """`default_value = 1` starts with the letters `def` but defines nothing."""
    event = _make_event(
        tool_name="mcp__codescout__edit_file",
        tool_input={"path": "src/app.py", "new_string": "default_value = 1\nother = 2\n"},
    )
    assert check(event, []) is None


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
    log = [_activate_entry("/other"), _activate_entry("/another")]
    result = check(_activate_event("/another"), log)
    assert result is not None
    assert "Iron Law 4" in result
    assert "`workspace" in result


def test_forgot_restore_ignores_workspace_calls_that_are_not_activations():
    """A workspace(action="status") after a restore is not a foreign activation.

    The log's latest ACTIVATION is the restore, so the next foreign activation is
    fine. If the check counted the status call as a prior activation, it would see
    a non-home entry and wrongly warn."""
    log = [
        _activate_entry("/other"),
        _activate_entry("."),
        _make_log_entry(
            tool="mcp__codescout__workspace",
            args=summarize_args({"action": "status"}),
        ),
        _activate_entry("/new"),
    ]
    assert check(_activate_event("/new"), log) is None


def test_workspace_status_is_not_an_activation():
    """The check keys on action="activate": other workspace actions never fire it."""
    log = [_activate_entry("/other"), _activate_entry("/another")]
    event = _make_event(
        tool_name="mcp__codescout__workspace",
        tool_input={"action": "status"},
    )
    assert check(event, log) is None


def test_restore_after_foreign_ok():
    log = [_activate_entry("/other"), _activate_entry("."), _activate_entry("/new")]
    assert check(_activate_event("/new"), log) is None


def test_first_foreign_activation_ok():
    """First foreign activation shouldn't trigger (no prior unrestored)."""
    assert check(_activate_event("/first"), [_activate_entry("/first")]) is None


def test_restore_by_absolute_path_ok():
    """Activating home by absolute path (== cwd) is a restore, not foreign."""
    home = "/home/me/project"
    log = [_activate_entry("/other"), _activate_entry(home)]
    assert check(_activate_event(home, cwd=home), log) is None


def test_restore_by_absolute_path_in_log_ok():
    """Prior log entry matching cwd counts as a restore."""
    home = "/home/me/project"
    log = [_activate_entry("/foreign"), _activate_entry(home), _activate_entry("/another")]
    assert check(_activate_event("/another", cwd=home), log) is None


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
    assert "`read_file`" in result and "`symbols`" in result


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
        _make_log_entry(tool="mcp__codescout__edit_code", ts=1000),
    ]
    event = _make_event(tool_name="mcp__codescout__edit_code")
    result = check(event, log)
    assert result is not None
    assert "BUG-021" in result


def test_sequential_writes_ok():
    log = [
        _make_log_entry(tool="mcp__codescout__edit_file", ts=1000),
        _make_log_entry(tool="mcp__codescout__edit_code", ts=1002),
    ]
    event = _make_event(tool_name="mcp__codescout__edit_code")
    result = check(event, log)
    assert result is None


# ── _check_grep_for_concept ────────────────────────────────────────────────

def test_grep_for_concept_detected():
    """Multi-word all-alpha phrase should suggest semantic_search."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "retry logic backoff"},
    )
    result = check(event, [])
    assert result is not None
    assert "semantic_search" in result


def test_grep_for_concept_two_words_detected():
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "authentication middleware"},
    )
    result = check(event, [])
    assert result is not None
    assert "semantic_search" in result


def test_grep_for_concept_regex_metachar_ok():
    """Pattern with regex metacharacters is a legitimate regex — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": r"fn handle_\w+"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_pipe_ok():
    """Pattern with | is a regex alternation — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "notification|push"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_short_ok():
    """Short patterns are literal lookups — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "pub fn"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_code_syntax_ok():
    """Pattern containing :: or -> is a code fragment — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "std::collections::HashMap"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_snake_case_ok():
    """Single snake_case identifier (contains __) — no hint."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": "derive_mood_from_signals"},
    )
    result = check(event, [])
    assert result is None


def test_grep_for_concept_wrong_tool_ok():
    """Only fires for grep, not other tools."""
    event = _make_event(
        tool_name="mcp__codescout__find_symbol",
        tool_input={"query": "authentication middleware"},
    )
    result = check(event, [])
    assert result is None

# The 17 patterns that fired this hint in the codescout transcripts modified after
# 2026-11-05 (docs/issues/2026-11-07-grep-for-concept-heuristic-fires-on-literal-
# phrase-searches.md, table "Evidence"). By that reading none was a concept query:
# each is text the agent already had in front of it. Three of them
# (`substrate fact`, `verify callers`, `matches text literally`) carry no function
# word and no identifier, so no shape test can tell them from a concept; they are
# not pinned here either way.
_LITERAL_PHRASES_THAT_FIRED = [
    # message or log text
    "another session wrote",
    "another mux instance holds the lock",
    "reference index is not ready",
    # phrase from a document
    "Filed the silent partial result as",
    "about a minute",
    "a gate started while the command runs gets another slot",
    "baselined against that layer",
    "ledger is shared parent",
    "only moves down",
    # definition fragment
    "function emitSkillHint",
    "export function contextPostToolUse",
    "class CrashSignalTests",
]


@pytest.mark.parametrize("pattern", _LITERAL_PHRASES_THAT_FIRED)
def test_grep_for_concept_literal_phrase_ok(pattern):
    """Quoted text and definition fragments are searched with grep on purpose."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": pattern},
    )
    assert check(event, []) is None


@pytest.mark.parametrize("pattern", [
    "retry logic backoff",
    "authentication middleware",
    "error handling retries",
    "how are retries scheduled",
    "where is the session state stored",
])
def test_grep_for_concept_genuine_concept_still_fires(pattern):
    """The negative cases above must not have switched the hint off."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": pattern},
    )
    result = check(event, [])
    assert result is not None
    assert "semantic_search" in result


@pytest.mark.parametrize("pattern", [
    "emitSkillHint handler",   # camelCase identifier, no definition keyword
    "struct session state",    # definition keyword, no identifier and no prose word
])
def test_grep_for_concept_each_identifier_rule_stands_alone(pattern):
    """Every definition fragment in the recorded list trips BOTH identifier rules, so
    removing either one would pass the list above. These trip one rule each."""
    event = _make_event(
        tool_name="mcp__codescout__grep",
        tool_input={"pattern": pattern},
    )
    assert check(event, []) is None


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


# --- every tool a hint names must exist ---
#
# A hint that names a tool the agent cannot call costs it a failed lookup or a
# wrong guess (claude-plugins:docs/issues/2026-11-04-buddy-native-bash-hint-names-
# find-symbol-which-no-longer-exists.md). The pinned list is the codescout
# server's tool list as served on 2026-11-09; update it when the server's tools
# change.

CODESCOUT_TOOLS = frozenset({
    "approve_write", "call_graph", "create_file", "doc", "edit_code",
    "edit_file", "get_guide", "grep", "index", "librarian", "library",
    "memory", "onboarding", "read_file", "references", "run_command",
    "semantic_search", "symbol_at", "symbols", "tree", "workspace",
})

# One event per check, chosen so that check() returns that check's hint.
_TRIGGERS = {
    "structural_edit": (
        _make_event(tool_name="mcp__codescout__edit_file",
                    tool_input={"path": "src/main.rs",
                                "new_string": "fn foo() {\n    bar()\n}\n"}),
        [],
    ),
    "forgot_restore": (
        _activate_event("/another"),
        [_activate_entry("/other"), _activate_entry("/another")],
    ),
    "ignored_buffer_ref": (
        _make_event(tool_name="mcp__codescout__symbols", tool_input={"path": "src/"}),
        [_make_log_entry(tool="mcp__codescout__run_command", args="cargo test",
                         outcome="buffered"),
         _make_log_entry(tool="mcp__codescout__symbols", args="path=src/")],
    ),
    "native_bash_on_source": (
        _make_event(tool_name="Bash", tool_input={"command": "cat src/main.rs"}),
        [],
    ),
    "parallel_write": (
        _make_event(tool_name="mcp__codescout__edit_code"),
        [_make_log_entry(tool="mcp__codescout__edit_file", ts=1000),
         _make_log_entry(tool="mcp__codescout__edit_code", ts=1000)],
    ),
    "grep_for_concept": (
        _make_event(tool_name="mcp__codescout__grep",
                    tool_input={"pattern": "retry logic backoff"}),
        [],
    ),
}

def _named_tools(hint):
    """The identifier right after each backtick: `edit_code`, `grep("x")` -> grep."""
    return set(re.findall(r"`([A-Za-z_]+)", hint))


@pytest.mark.parametrize("name", sorted(_TRIGGERS))
def test_each_trigger_fires_a_hint(name):
    # Guards the next test: a trigger that returns None would check nothing.
    event, log = _TRIGGERS[name]
    assert check(event, log) is not None


@pytest.mark.parametrize("name", sorted(_TRIGGERS))
def test_every_tool_a_hint_names_is_a_current_codescout_tool(name):
    event, log = _TRIGGERS[name]
    unknown = _named_tools(check(event, log)) - CODESCOUT_TOOLS
    assert not unknown, f"{name} hint names tools codescout does not have: {sorted(unknown)}"
