#!/usr/bin/env python3
"""CLI helper for summon/dismiss state mutations.

Replaces fragile inline `python3 -c "..."` blocks in summon.md / dismiss.md.
Idempotent; silent on missing session (exit 0).

Usage:
    track_specialist.py summon <directory>
    track_specialist.py dismiss [<directory>]   # no arg = dismiss all
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from scripts.state import (  # noqa: E402
    load_state,
    save_state,
    session_state_path,
    resolve_session_id_for_command,
)


def _project_root() -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR", "").strip()
    if env:
        p = Path(env)
        if p.is_dir():
            return p
    return Path.cwd()


def _resolve_sid(project: Path) -> str | None:
    pointer = project / ".buddy" / ".current_session_id"
    if pointer.is_file():
        try:
            sid = pointer.read_text(encoding="utf-8").strip()
            if sid:
                return sid
        except OSError:
            pass
    try:
        return resolve_session_id_for_command(project, os.getppid())
    except Exception:
        return None


def cmd_summon(directory: str) -> int:
    project = _project_root()
    sid = _resolve_sid(project)
    if not sid:
        print("buddy: no active session — send any prompt first", file=sys.stderr)
        return 0
    path = session_state_path(project, sid)
    state = load_state(path)
    active = state.setdefault("active_specialists", [])
    if directory not in active:
        active.append(directory)
    save_state(path, state)
    return 0


def cmd_dismiss(directory: str | None) -> int:
    project = _project_root()
    sid = _resolve_sid(project)
    if not sid:
        print("buddy: no active session — send any prompt first", file=sys.stderr)
        return 0
    path = session_state_path(project, sid)
    state = load_state(path)
    if directory is None:
        state["active_specialists"] = []
    else:
        active = state.get("active_specialists", []) or []
        if directory in active:
            active.remove(directory)
        state["active_specialists"] = active
    save_state(path, state)
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: track_specialist.py {summon <dir> | dismiss [<dir>]}",
              file=sys.stderr)
        return 2
    action = argv[0]
    if action == "summon":
        if len(argv) < 2:
            print("usage: track_specialist.py summon <dir>", file=sys.stderr)
            return 2
        return cmd_summon(argv[1])
    if action == "dismiss":
        target = argv[1] if len(argv) > 1 else None
        return cmd_dismiss(target)
    print(f"unknown action: {action}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
