"""Cross-platform Python entry points for the buddy hooks.

Each run_* function replaces the corresponding bash wrapper (session-start.sh,
user-prompt-submit.sh, pre-tool-use.sh, post-tool-use.sh, session-end.sh),
folding the wrappers' jq / ps / sed / mkdir / echo and multiple `python -c`
blocks into one Python call. They are invoked by hooks/hook_dispatch.py, which
is in turn launched by hooks/run.mjs — so no bash, jq, ps, or sed is required
and the hooks run wherever Python does (Windows included).

Every function is fail-open: it must never raise into the dispatcher. The one
exception is run_pre_tool_use, which returns 2 to request an intentional block
(only when BUDDY_JUDGE_BLOCK=true and a blocking verdict is present).
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path


def _project_root(event: dict) -> Path:
    cwd = event.get("cwd") or ""
    return Path(cwd) if cwd else Path(os.getcwd())


def _session_id(event: dict) -> str:
    return event.get("session_id") or "unknown"


def _ensure_timestamp(event: dict) -> None:
    if "timestamp" not in event:
        event["timestamp"] = int(time.time())


def run_session_start(event: dict, plugin_root: Path, ppid: int) -> int:
    from scripts import buddy_paths, state
    from scripts.consolidate import (
        auto_dry_run_eligible,
        read_auto_trigger_config,
        session_start_nudges,
    )
    from scripts.hook_helpers import auto_migrate_if_needed, handle_session_start

    project_root = _project_root(event)
    sid = _session_id(event)
    buddy_dir = project_root / ".buddy"

    # Capture previous session id BEFORE overwriting the pointer (reload uses it).
    prev = ""
    pointer = buddy_dir / ".current_session_id"
    if pointer.is_file():
        try:
            prev = pointer.read_text().strip()
        except OSError:
            prev = ""
    os.environ["BUDDY_PREV_SID"] = prev

    # PPID index + GC (replaces the ps/sed/mkdir/echo bash block).
    state.update_ppid_index(project_root, sid, ppid)
    state.gc_ppid_index(project_root, keep_ppid=ppid)

    # One-shot removal of the dead per-profile global state.json.
    try:
        (Path.home() / ".claude" / "buddy" / "state.json").unlink(missing_ok=True)
    except OSError:
        pass

    # Auto-migrate legacy per-profile global memory into ~/.buddy.
    try:
        line = auto_migrate_if_needed()
        if line:
            print(line)
    except Exception:
        pass

    # Memory roots: global + project.
    roots = []
    try:
        gm = buddy_paths.global_memory()
        if gm.is_dir():
            roots.append(gm)
    except Exception:
        pass
    proj_mem = project_root / ".buddy" / "memory"
    if proj_mem.is_dir():
        roots.append(proj_mem)

    # Consolidation nudges.
    for r in roots:
        try:
            for line in session_start_nudges(r):
                print(line)
        except Exception:
            pass

    # Optional auto-dry-run (opt-in via .claude/buddy.json).
    try:
        cfg = read_auto_trigger_config(project_root)
        for r in roots:
            target = auto_dry_run_eligible(r, cfg)
            if target:
                print(
                    f"→ memory: auto-trigger enabled — most-overdue: {r}\t{target}. "
                    "Run /buddy:consolidate to start the dry-run."
                )
                break
    except Exception:
        pass

    # Core session-start state handling.
    _ensure_timestamp(event)
    session_dir = project_root / ".buddy" / sid
    try:
        handle_session_start(
            event,
            path=session_dir / "state.json",
            narrative_path=session_dir / "narrative.jsonl",
            verdicts_path=session_dir / "verdicts.json",
        )
    except Exception:
        pass
    return 0


def run_user_prompt_submit(event: dict, plugin_root: Path, ppid: int) -> int:
    from scripts import state
    from scripts.hook_helpers import handle_user_prompt_submit
    from scripts.skill_ledger import scan_from_event

    project_root = _project_root(event)
    sid = _session_id(event)

    # PPID index (no GC here — matches the wrapper).
    state.update_ppid_index(project_root, sid, ppid)

    _ensure_timestamp(event)
    try:
        handle_user_prompt_submit(event, path=project_root / ".buddy" / sid / "state.json")
    except Exception:
        pass

    # Skill ledger: repeat-load advisories only (silent otherwise).
    try:
        for line in scan_from_event(event):
            print(line)
    except Exception:
        pass

    # Summon bootstrap for /buddy:summon prompts (zero model tool calls).
    prompt = event.get("prompt") or ""
    if prompt.startswith("/buddy:summon"):
        try:
            from scripts import summon_bootstrap
            payload = summon_bootstrap.bootstrap(event)
            if payload:
                print(payload)
        except Exception:
            pass
    return 0


def run_pre_tool_use(event: dict, plugin_root: Path, ppid: int) -> int:
    judge_on = os.environ.get("BUDDY_JUDGE_ENABLED") == "true"
    cs_judge_on = os.environ.get("BUDDY_CS_JUDGE_ENABLED") == "true"
    if not judge_on and not cs_judge_on:
        return 0

    from scripts.pre_tool_gate import build_correction_message, should_block

    project_root = _project_root(event)
    sid = _session_id(event)
    session_dir = project_root / ".buddy" / sid

    all_blocking = []
    if judge_on:
        blocked, verdicts = should_block(session_dir / "verdicts.json")
        if blocked:
            all_blocking.extend(verdicts)
    if cs_judge_on:
        cs_blocked, cs_verdicts = should_block(
            session_dir / "cs_verdicts.json", min_severity="blocking"
        )
        if cs_blocked:
            all_blocking.extend(cs_verdicts)

    if all_blocking and os.environ.get("BUDDY_JUDGE_BLOCK") == "true":
        try:
            msg = build_correction_message(all_blocking)
            print(msg, file=sys.stderr)
        except Exception:
            return 0
        return 2
    return 0


def run_post_tool_use(event: dict, plugin_root: Path, ppid: int) -> int:
    from scripts.hook_helpers import accumulate_narrative, handle_post_tool_use

    project_root = _project_root(event)
    sid = _session_id(event)
    _ensure_timestamp(event)
    session_dir = project_root / ".buddy" / sid
    try:
        handle_post_tool_use(event, path=session_dir / "state.json")
    except Exception:
        pass
    try:
        accumulate_narrative(
            event,
            session_dir / "narrative.jsonl",
            project_root=project_root,
            session_id=sid,
        )
    except Exception:
        pass
    return 0


def run_session_end(event: dict, plugin_root: Path, ppid: int) -> int:
    from scripts import state
    state.remove_ppid_entry(_project_root(event), ppid)
    return 0


DISPATCH = {
    "session-start": run_session_start,
    "user-prompt-submit": run_user_prompt_submit,
    "pre-tool-use": run_pre_tool_use,
    "post-tool-use": run_post_tool_use,
    "session-end": run_session_end,
}
