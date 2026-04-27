"""Hook event handlers that mutate state.json.

Each handler is called by a thin bash wrapper that passes the Claude Code
hook event JSON via stdin. All handlers are silent on failure.
"""
import fnmatch
import os
import re
import subprocess
from pathlib import Path

from scripts.state import load_state, save_state
from scripts.narrative import append_entry, read_narrative
from scripts.judge_worker import format_action_entry

MAX_RECENT_ERRORS = 10

_SESSION_SCOPED_FIELDS = {
    "session_start_ts",
    "prompt_count",
    "tool_call_count",
    "recent_errors",
    "idle_ts",
    "context_pct",
    "last_test_result",
    "cs_tool_call_count",
}



PLAN_TOOL_PATH_KEYS = {
    "Edit": "file_path",
    "Write": "file_path",
    "Read": "file_path",
    "NotebookEdit": "file_path",
    "mcp__codescout__read_file": "path",
    "mcp__codescout__read_markdown": "path",
    "mcp__codescout__edit_file": "path",
    "mcp__codescout__create_file": "path",
    "mcp__codescout__insert_code": "path",
    "mcp__codescout__replace_symbol": "path",
    "mcp__codescout__remove_symbol": "path",
}

DEFAULT_PLAN_GLOBS = "docs/superpowers/plans/*.md:docs/superpowers/specs/*.md"


def _matches_plan_glob(rel_path: str) -> bool:
    """Match `rel_path` against BUDDY_PLAN_GLOBS (colon-separated)."""
    raw = os.environ.get("BUDDY_PLAN_GLOBS", DEFAULT_PLAN_GLOBS)
    for glob in raw.split(":"):
        glob = glob.strip()
        if not glob:
            continue
        if fnmatch.fnmatchcase(rel_path, glob):
            return True
    return False


def detect_plan_touch(event: dict, project_root: Path) -> str | None:
    """Return a project-relative plan path if this tool event touched one.

    Returns None for any unknown tool, missing path, path outside project,
    or path that does not match BUDDY_PLAN_GLOBS.
    """
    try:
        tool = event.get("tool_name", "")
        key = PLAN_TOOL_PATH_KEYS.get(tool)
        if not key:
            return None
        path_str = (event.get("tool_input") or {}).get(key)
        if not path_str:
            return None
        p = Path(path_str)
        if p.is_absolute():
            try:
                p = p.relative_to(project_root)
            except ValueError:
                return None  # path outside project
        rel = str(p)
        if not _matches_plan_glob(rel):
            return None
        return rel
    except Exception:
        return None


def handle_session_start(
    event: dict,
    path: Path,
    narrative_path: Path | None = None,
    verdicts_path: Path | None = None,
) -> None:
    try:
        state = load_state(path)
        ts = int(event.get("timestamp") or 0)
        incoming_sid = event.get("session_id", "")
        # SessionStart carries a "source" field: startup | resume | clear | compact.
        # Only "startup" events can originate from a subagent; resume/clear/compact
        # are user-initiated on the same session and must always reset signals.
        source = event.get("source", "startup")
        stored_sid = state.get("current_session_id", "")
        prev_start_ts = int(state["signals"].get("session_start_ts", 0))

        # Subagent guard: a "startup" from a different session_id while the
        # current session started <600s ago is a spawned subagent.
        # Only clear the subagent's own session files; leave parent signals alone.
        is_subagent = (
            source == "startup"
            and stored_sid
            and incoming_sid
            and incoming_sid != stored_sid
            and ts - prev_start_ts < 600
        )
        if is_subagent:
            if narrative_path:
                try:
                    narrative_path.unlink(missing_ok=True)
                except Exception:
                    pass
            if verdicts_path:
                from scripts.verdicts import clear_verdicts
                clear_verdicts(verdicts_path)
                try:
                    clear_verdicts(verdicts_path.parent / "cs_verdicts.json")
                except Exception:
                    pass
                try:
                    (verdicts_path.parent / "cs_tool_log.jsonl").unlink(missing_ok=True)
                except Exception:
                    pass
            return

        # Real new top-level session (startup with gap, resume, clear, compact) —
        # full signal reset.
        state["current_session_id"] = incoming_sid
        for field in _SESSION_SCOPED_FIELDS:
            if field == "recent_errors":
                state["signals"][field] = []
            elif field == "last_test_result":
                state["signals"][field] = None
            elif field == "session_start_ts":
                state["signals"][field] = ts
            elif field == "idle_ts":
                state["signals"][field] = ts
            else:
                state["signals"][field] = 0

        # Clear judge signals
        state["signals"]["judge_verdict"] = None
        state["signals"]["judge_severity"] = None
        state["signals"]["judge_block_count"] = 0
        state["signals"]["judge_last_ts"] = 0

        # Clear codescout judge signals
        state["signals"]["cs_judge_verdict"] = None
        state["signals"]["cs_judge_severity"] = None
        state["signals"]["cs_active_project"] = None

        state["signals"]["root_cwd"] = ""

        save_state(path, state)

        # Clear narrative and verdicts for new session
        if narrative_path:
            try:
                narrative_path.unlink(missing_ok=True)
            except Exception:
                pass
        if verdicts_path:
            from scripts.verdicts import clear_verdicts
            clear_verdicts(verdicts_path)
            try:
                clear_verdicts(verdicts_path.parent / "cs_verdicts.json")
            except Exception:
                pass
            try:
                (verdicts_path.parent / "cs_tool_log.jsonl").unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass


def handle_post_tool_use(event: dict, path: Path) -> None:
    try:
        state = load_state(path)
        sig = state["signals"]

        sig["tool_call_count"] = int(sig.get("tool_call_count", 0)) + 1

        tool_name = event.get("tool_name", "")
        ts = int(event.get("timestamp") or 0)

        if tool_name in ("Edit", "Write", "NotebookEdit"):
            sig["last_edit_ts"] = ts

        if tool_name == "Bash":
            command = (event.get("tool_input") or {}).get("command", "")
            if re.search(r"\bgit\s+commit\b", command):
                sig["last_commit_ts"] = ts
            if _looks_like_test_run(command):
                result = _parse_test_result(event.get("tool_output", ""), ts)
                if result:
                    sig["last_test_result"] = result

        error = event.get("tool_error")
        if error:
            sig["recent_errors"].append(
                {"ts": ts, "tool": tool_name, "error": str(error)[:200]}
            )
            if len(sig["recent_errors"]) > MAX_RECENT_ERRORS:
                sig["recent_errors"] = sig["recent_errors"][-MAX_RECENT_ERRORS:]

        save_state(path, state)

        # Codescout tool usage observer — covers both codescout MCP calls and
        # Bash (for native-tool-on-source heuristic). Bash takes a fast path
        # inside handle_cs_tool_use (heuristics only, no log/count/judge).
        if tool_name.startswith("mcp__codescout__") or tool_name == "Bash":
            session_id = event.get("session_id", "unknown")
            # Use event["cwd"] directly — not state.signals.root_cwd.
            # root_cwd is a shared global signal overwritten by every concurrent
            # session; using it here causes cross-session path corruption.
            # pre-tool-use.sh and session-start.sh both use event["cwd"], so
            # using the same source here keeps all three hooks on the same path.
            session_dir = Path(event.get("cwd") or os.getcwd()) / ".buddy" / session_id
            handle_cs_tool_use(event, session_dir, path, session_id)
    except Exception:
        pass


def handle_cs_tool_use(
    event: dict,
    session_dir: Path,
    state_path: Path,
    session_id: str,
) -> None:
    """Handle codescout MCP tool calls: log, heuristics, async judge spawn.

    Called from handle_post_tool_use for mcp__codescout__* tools AND Bash.
    Bash events take the fast path: heuristics only, no log/count/judge spawn.
    """
    try:
        from scripts.cs_heuristics import check as cs_check

        tool_name = event.get("tool_name", "")

        # ── Bash fast path: heuristics only ────────────────────────────────
        if tool_name == "Bash":
            heuristics_enabled = os.environ.get(
                "BUDDY_CS_HEURISTICS_ENABLED", "true",
            ) == "true"
            if heuristics_enabled:
                state = load_state(state_path)
                root_cwd = state["signals"].get("root_cwd", "")
                correction = cs_check(event, [], root_cwd=root_cwd)
                if correction:
                    import json as _json
                    print(_json.dumps({
                        "hookSpecificOutput": {
                            "hookEventName": "PostToolUse",
                            "additionalContext": f"[cs-hint] {correction}",
                        },
                    }))
            return

        # ── Codescout tool path: log + heuristics + count + judge spawn ─────
        from scripts.cs_tool_log import append_entry as cs_append, summarize_args

        tool_input = event.get("tool_input") or {}
        # "buffered" when run_command returned an output_id handle — used by
        # _check_ignored_buffer_ref to avoid false positives from commands
        # whose *input* text happens to contain "@cmd_" (e.g. grep patterns).
        _response = event.get("tool_response") or {}
        if event.get("tool_error"):
            outcome = "error"
        elif isinstance(_response, dict) and "output_id" in _response:
            outcome = "buffered"
        else:
            outcome = "ok"

        # 1. Append to cs tool log (returns full log for heuristic look-back)
        cs_log_path = session_dir / "cs_tool_log.jsonl"
        session_log = cs_append(
            cs_log_path,
            tool=tool_name,
            args_summary=summarize_args(tool_input),
            outcome=outcome,
        )

        # Load state once — used by both heuristics (root_cwd) and step 3.
        state = load_state(state_path)
        sig = state["signals"]

        # 2. Run heuristics (sync) — inject correction into conversation via
        #    Claude Code's hookSpecificOutput.additionalContext mechanism.
        #    Plain print() is ignored; JSON output is required for injection.
        heuristics_enabled = os.environ.get(
            "BUDDY_CS_HEURISTICS_ENABLED", "true",
        ) == "true"
        if heuristics_enabled:
            root_cwd = sig.get("root_cwd", "")
            correction = cs_check(event, session_log, root_cwd=root_cwd)
            if correction:
                import json as _json
                print(_json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": f"[cs-hint] {correction}",
                    },
                }))

        # 3. Track cs_active_project.
        #    The authoritative project root comes from tool_response["project_root"],
        #    not event["cwd"] (which is the CC process CWD, often != project root).
        #    On the first activate_project(".") call, capture and store root_cwd.
        if tool_name == "mcp__codescout__activate_project":
            import os as _os
            path_arg = tool_input.get("path", "")
            resp_root = ""
            if isinstance(_response, dict):
                resp_root = _response.get("project_root", "")

            # Capture home project root from activate_project response.
            # Two triggers:
            # 1. path="." always means home — update root_cwd unconditionally
            # 2. First activation in session (root_cwd empty) — per Iron Law 5,
            #    the first activation IS the home project
            if resp_root and (path_arg == "." or not sig.get("root_cwd")):
                sig["root_cwd"] = resp_root

            home_cwd = sig.get("root_cwd") or event.get("cwd", "")
            is_home = (
                path_arg == "."
                or bool(
                    home_cwd
                    and path_arg
                    and _os.path.normpath(path_arg) == _os.path.normpath(home_cwd)
                )
                or bool(
                    resp_root
                    and home_cwd
                    and _os.path.normpath(resp_root) == _os.path.normpath(home_cwd)
                )
            )
            sig["cs_active_project"] = None if is_home else path_arg

        # 4. Increment cs_tool_call_count + maybe spawn judge
        sig["cs_tool_call_count"] = int(sig.get("cs_tool_call_count", 0)) + 1
        save_state(state_path, state)

        cs_judge_enabled = os.environ.get(
            "BUDDY_CS_JUDGE_ENABLED", "false",
        ) == "true"
        if not cs_judge_enabled:
            return

        interval = int(os.environ.get("BUDDY_CS_JUDGE_INTERVAL", "4"))
        count = sig["cs_tool_call_count"]
        if count > 0 and count % interval == 0:
            cs_verdicts_path = session_dir / "cs_verdicts.json"
            project_root = session_dir.parent.parent  # .buddy/<sid> → project
            plugin_root = str(Path(__file__).parent.parent)
            subprocess.Popen(
                [
                    "python3", "-m", "scripts.cs_judge_worker",
                    str(cs_log_path),
                    str(cs_verdicts_path),
                    str(project_root),
                    session_id,
                ],
                cwd=plugin_root,
                env={**os.environ, "PYTHONPATH": plugin_root},
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception:
        pass


def handle_user_prompt_submit(event: dict, path: Path) -> None:
    try:
        state = load_state(path)
        sig = state["signals"]
        ts = int(event.get("timestamp") or 0)
        sig["prompt_count"] = int(sig.get("prompt_count", 0)) + 1
        sig["idle_ts"] = ts
        save_state(path, state)
    except Exception:
        pass


def _looks_like_test_run(command: str) -> bool:
    patterns = (
        r"\bpytest\b", r"\bcargo\s+test\b", r"\bgo\s+test\b",
        r"\bnpm\s+test\b", r"\byarn\s+test\b", r"\bjest\b",
        r"\bvitest\b", r"\bunittest\b",
    )
    return any(re.search(p, command) for p in patterns)


def _parse_test_result(output: str, ts: int):
    """Best-effort test-result parse. Looks for 'N passed, M failed' style lines."""
    m = re.search(r"(\d+)\s+passed.*?(\d+)\s+failed", output, re.IGNORECASE)
    if m:
        return {"ts": ts, "passed": int(m.group(1)), "failed": int(m.group(2))}
    m = re.search(r"(\d+)\s+failed", output, re.IGNORECASE)
    if m:
        return {"ts": ts, "passed": 0, "failed": int(m.group(1))}
    return None


def accumulate_narrative(
    event: dict,
    narrative_path: Path,
    project_root: Path,
    session_id: str,
) -> None:
    """Append a narrative entry and maybe spawn the judge worker."""
    try:
        action_text = format_action_entry(event)
        append_entry(narrative_path, "action", action_text)

        # Plan-focus auto-detection (silent on failure)
        try:
            from scripts.state import save_active_plan
            import time as _time
            touched = detect_plan_touch(event, project_root)
            if touched:
                save_active_plan(
                    session_dir=narrative_path.parent,
                    path=touched,
                    source="auto",
                    now=int(_time.time()),
                )
        except Exception:
            pass

        # Check if we should spawn the judge
        judge_enabled = os.environ.get("BUDDY_JUDGE_ENABLED", "false") == "true"
        if not judge_enabled:
            return

        interval = int(os.environ.get("BUDDY_JUDGE_INTERVAL", "5"))
        entry_count = len(read_narrative(narrative_path))
        if entry_count > 0 and entry_count % interval == 0:
            verdicts_path = narrative_path.parent / "verdicts.json"
            state_path = project_root / ".buddy" / session_id / "state.json"
            plugin_root = str(Path(__file__).parent.parent)
            subprocess.Popen(
                [
                    "python3", "-m", "scripts.judge_worker",
                    str(narrative_path),
                    str(verdicts_path),
                    str(project_root),
                    session_id,
                    str(state_path),
                ],
                cwd=plugin_root,
                env={**os.environ, "PYTHONPATH": plugin_root},
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception:
        pass
