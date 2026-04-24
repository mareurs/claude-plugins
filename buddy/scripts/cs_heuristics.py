"""Deterministic codescout usage pattern checkers (Tier 1).

Pure functions — no I/O, no LLM.  Each checker receives the current hook
event and the recent session log, returns a correction string or None.
Called synchronously in handle_cs_tool_use; non-None results are printed
to stdout (injected into conversation by Claude Code).
"""
from __future__ import annotations

# File extensions where LSP is active and structural edits should use
# replace_symbol / insert_code / remove_symbol instead of edit_file.
_LSP_EXTENSIONS = frozenset({
    ".rs", ".py", ".ts", ".tsx", ".js", ".jsx",
    ".java", ".kt", ".go", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".rb", ".swift", ".scala",
})

# Definition keywords that signal a structural edit (not a comment/string tweak).
_DEFINITION_KEYWORDS = (
    "def ", "fn ", "class ", "struct ", "impl ", "enum ",
    "trait ", "interface ", "func ", "function ",
)

# Tools that perform writes (used by parallel-write heuristic).
_WRITE_TOOLS = frozenset({
    "Edit", "Write",
    "mcp__codescout__edit_file",
    "mcp__codescout__create_file",
    "mcp__codescout__replace_symbol",
    "mcp__codescout__insert_code",
    "mcp__codescout__remove_symbol",
})

# Source file extensions where Bash cat/head/tail/sed should be avoided.
_SOURCE_EXTENSIONS = _LSP_EXTENSIONS | frozenset({
    ".json", ".toml", ".yaml", ".yml",
})


def check(event: dict, session_log: list[dict], root_cwd: str = "") -> str | None:
    """Run all heuristics in priority order.  Returns first correction or None."""
    try:
        checks = [
            _check_structural_edit,
            lambda e, l: _check_forgot_restore(e, l, root_cwd),
            _check_ignored_buffer_ref,
            _check_native_bash_on_source,
            _check_parallel_write,
            _check_grep_for_concept,
        ]
        for fn in checks:
            result = fn(event, session_log)
            if result is not None:
                return result
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Individual heuristics
# ---------------------------------------------------------------------------

def _check_structural_edit(event: dict, session_log: list[dict]) -> str | None:
    """Detect edit_file used for structural code changes on LSP-supported files."""
    tool = event.get("tool_name", "")
    if tool != "mcp__codescout__edit_file":
        return None

    tool_input = event.get("tool_input") or {}
    new_string = tool_input.get("new_string", "")
    file_path = tool_input.get("path", "") or tool_input.get("file_path", "")

    # Check file extension
    if not any(file_path.endswith(ext) for ext in _LSP_EXTENSIONS):
        return None

    # Check if new_string contains definition keywords on multi-line content
    lines = new_string.strip().splitlines()
    if len(lines) < 2:
        return None

    for line in lines:
        stripped = line.lstrip()
        if any(stripped.startswith(kw) for kw in _DEFINITION_KEYWORDS):
            return (
                "Use `replace_symbol` for structural edits — "
                "`edit_file` on definition bodies risks LSP range "
                "corruption (BUG-027)."
            )

    return None



def _is_home_path(path: str, cwd: str) -> bool:
    """Check if path refers to the home project (cwd) via '.' or absolute path."""
    import os
    if path == ".":
        return True
    if not cwd or not path:
        return False
    return os.path.normpath(path) == os.path.normpath(cwd)


def _args_look_like_home(args_summary: str, cwd: str) -> bool:
    """Check if a log entry's args summary indicates a home-restore activation."""
    if "path=." in args_summary or 'path="."' in args_summary:
        return True
    if cwd and cwd in args_summary:
        return True
    return False


def _check_forgot_restore(event: dict, session_log: list[dict], root_cwd: str = "") -> str | None:
    """Detect a foreign activate_project when the previous one was also foreign.

    Pattern: warn only when the most recent prior activate_project was a foreign
    path (meaning the user never restored home). First foreign activation and
    activations that follow a proper restore are both silent.
    """
    tool = event.get("tool_name", "")
    if tool != "mcp__codescout__activate_project":
        return None

    tool_input = event.get("tool_input") or {}
    path = tool_input.get("path", "")

    import os
    cwd = root_cwd or event.get("cwd", "")
    if _is_home_path(path, cwd):
        return None  # this IS a restore — not a foreign activation

    # Walk backwards to find the most recent activate_project before this one.
    for entry in reversed(session_log[:-1]):  # [:-1] excludes current entry
        if entry.get("tool") == "mcp__codescout__activate_project":
            args = entry.get("args", "")
            if _args_look_like_home(args, cwd):
                return None  # prior was a restore — user is cycling correctly
            # Prior was also foreign: user forgot to restore before switching again.
            return (
                "You activated a foreign project without restoring home first. "
                "Restore with `activate_project('.')` between projects — Iron Law 4."
            )

    # No prior activate_project in this session — first foreign activation, silent.
    return None


def _check_ignored_buffer_ref(event: dict, session_log: list[dict]) -> str | None:
    """Detect when a run_command output buffer is ignored by the next call."""
    if len(session_log) < 2:
        return None

    prev = session_log[-2]

    # Previous call must be run_command whose output contained a buffer ref
    if prev.get("tool") != "mcp__codescout__run_command":
        return None

    # Only fire when the previous call actually produced a buffer (outcome="buffered").
    # Checking args for "@cmd_" caused false positives when grep patterns or command
    # strings contained that substring literally.
    if prev.get("outcome") != "buffered":
        return None

    # Current call should reference the buffer — check tool_input for @cmd_
    tool_input = event.get("tool_input") or {}
    input_str = str(tool_input)
    if "@cmd_" in input_str:
        return None  # good — they're using the buffer

    # Only fire if current call is a codescout tool (not a random Edit/Bash)
    tool = event.get("tool_name", "")
    if not tool.startswith("mcp__codescout__"):
        return None

    return (
        "Large output was buffered as `@cmd_*`. Query it with "
        "`run_command('grep PATTERN @cmd_id')` instead of ignoring."
    )


def _check_native_bash_on_source(event: dict, session_log: list[dict]) -> str | None:
    """Detect Bash cat/head/tail/sed on source files."""
    tool = event.get("tool_name", "")
    if tool != "Bash":
        return None

    tool_input = event.get("tool_input") or {}
    command = tool_input.get("command", "")
    if not command:
        return None

    # Check for cat/head/tail/sed commands
    import re
    match = re.search(
        r"\b(cat|head|tail|sed)\b.*?(\S+\.\w+)", command,
    )
    if not match:
        return None

    file_ref = match.group(2)
    if any(file_ref.endswith(ext) for ext in _SOURCE_EXTENSIONS):
        return (
            "Use `read_file` or `find_symbol` — Bash on source files "
            "bypasses codescout's LSP index."
        )

    return None


def _check_parallel_write(event: dict, session_log: list[dict]) -> str | None:
    """Detect parallel writes (same-second timestamps on write-class tools)."""
    tool = event.get("tool_name", "")
    if tool not in _WRITE_TOOLS:
        return None

    if len(session_log) < 2:
        return None

    prev = session_log[-2]
    if prev.get("tool") not in _WRITE_TOOLS:
        return None

    # Same-second = parallel dispatch
    current_ts = session_log[-1].get("ts", 0) if session_log else 0
    prev_ts = prev.get("ts", 0)
    if current_ts == prev_ts and current_ts > 0:
        return (
            "Parallel writes risk inconsistent state (BUG-021) — "
            "serialize write tool calls."
        )

    return None


def _check_grep_for_concept(event: dict, session_log: list[dict]) -> str | None:
    """Detect search_pattern used with a natural-language concept phrase.

    search_pattern matches text literally (regex). When the pattern looks like
    a concept description rather than a code fragment or regex, semantic_search
    will find semantically related code without requiring an exact text match.

    Decision table (from codescout manual):
      "A text fragment"        → search_pattern  ✓
      "The concept, not name"  → semantic_search  ← this heuristic fires here
    """
    import re as _re

    if event.get("tool_name") != "mcp__codescout__search_pattern":
        return None

    pattern = (event.get("tool_input") or {}).get("pattern", "")

    # Too short to be a concept phrase
    if len(pattern) < 12:
        return None

    # Contains regex metacharacters → legitimate regex, not a concept phrase
    if _re.search(r'[\\^$.*+?()|\[\]{}]', pattern):
        return None

    # Contains code-syntax tokens → legitimate code fragment search
    if any(tok in pattern for tok in ("::", "->", "=>", "__")):
        return None

    # 2+ space-separated all-alpha words → natural-language concept phrase
    words = pattern.split()
    if len(words) >= 2 and all(_re.match(r"^[a-zA-Z]+$", w) for w in words):
        return (
            f'`search_pattern("{pattern}")` matches text literally. '
            f"For concept queries, `semantic_search` finds related code "
            f"by meaning without requiring an exact text match."
        )

    return None
