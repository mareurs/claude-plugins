#!/usr/bin/env python3
"""buddy reports for the OpenCode TUI: `status` and `legend`, computed without the model.

On Claude Code, /buddy:status and /buddy:legend are prompts (both `disable-model-invocation`)
that tell the model to run a few lines of buddy's Python and print the result. On OpenCode a
prompt sent to a busy session is delivered with `delivery: "steer"`, which interrupts the
turn in progress. These reports have no reasoning in them, so the TUI part (tui.js) runs
this script instead and shows the text in a dialog: the session keeps working.

Same sources as the two commands, through buddy's own modules — nothing is recomputed here:
  status  state.json of the given session, identity.json, buddha.derive_mood, file freshness
  legend  active specialists via specialist_labels.resolve_labels, then the static part of
          buddy/commands/legend.md (its "## Buddy Legend" section), read from the file

usage: report.py status|legend <buddy-root> <project-root> <session-id>
Prints markdown (the TUI renders it in a dialog). Exits 0 always; problems are reported
in the text.
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path


def _signals_line(sig: dict, key: str) -> str:
    v = sig.get(key)
    if key.endswith("_ts") and isinstance(v, (int, float)) and v:
        return f"{key}: {datetime.fromtimestamp(v).strftime('%H:%M:%S')} ({int(time.time() - v)}s ago)"
    if key == "last_test_result" and isinstance(v, dict):
        return f"{key}: {v.get('status', '?')} at {v.get('ts', '?')}"
    return f"{key}: {v if v not in (None, '') else '-'}"


def _as_markdown(lines: list[str]) -> str:
    """Section names become `###` headings, `  key: value` rows become list items."""
    out = []
    for ln in lines:
        if not ln.strip():
            out.append("")
        elif ln.startswith("  "):
            out.append(f"- {ln.strip()}")
        elif ":" in ln:
            out.append(f"- {ln}")
        else:
            out.append(f"### {ln}")
    return "\n".join(out)


def status(buddy: Path, project: Path, sid: str) -> str:
    text = _status_lines(buddy, project, sid)
    return text if "\n" not in text else _as_markdown(text.split("\n"))  # a one-line notice stays plain


def _status_lines(buddy: Path, project: Path, sid: str) -> str:
    from scripts import buddy_paths
    from scripts.buddha import derive_mood
    from scripts.identity import load_identity
    from scripts.state import load_state

    out = []
    if not sid:
        return "no active buddy session in this project root"
    state_path = project / ".buddy" / sid / "state.json"
    out.append(f"session: {sid}")
    out.append(f"project: {project}")

    user_id = os.environ.get("CLAUDE_CODE_USER_ID") or os.environ.get("USER", "user")
    ident_path = buddy_paths.identity_path()
    ident = load_identity(ident_path, user_id=user_id)
    out.append("")
    out.append("Identity")
    out.append(f"  form: {ident.get('form', '?')}   name: {ident.get('name', '?')}   "
               f"hatched: {'yes' if ident.get('hatched') else 'no'}")

    if not state_path.is_file():
        out.append("")
        out.append(f"state.json: missing ({state_path}) — a fresh session, or hooks are not firing")
        return "\n".join(out)

    state = load_state(state_path)
    sig = state.get("signals", {}) or {}
    mood, suggested = derive_mood(sig, int(time.time()), datetime.now().hour)
    out.append("")
    out.append("Mood")
    out.append(f"  derived_mood: {mood}   suggested_specialist: {suggested or '-'}")
    active = state.get("active_specialists", []) or []
    out.append(f"  active_specialists: {', '.join(active) if active else '(none)'}")

    out.append("")
    out.append("Signals")
    for k in ("context_pct", "last_edit_ts", "last_commit_ts", "session_start_ts", "prompt_count",
              "tool_call_count", "last_test_result", "idle_ts"):
        out.append("  " + _signals_line(sig, k))
    out.append(f"  recent_errors: {len(sig.get('recent_errors') or [])}")

    age = int(time.time() - state_path.stat().st_mtime)
    out.append("")
    out.append("Hook health")
    if age <= 300:
        out.append(f"  state.json updated {age}s ago — hooks are firing")
    else:
        out.append(f"  WARNING: state.json last updated {age}s ago (> 5 min) — hooks may not be firing")
    return "\n".join(out)


def _legend_static(buddy: Path) -> str:
    """The `## Buddy Legend` block of legend.md, with OpenCode's dashed command names."""
    text = (buddy / "commands" / "legend.md").read_text(encoding="utf-8")
    start = text.find("## Buddy Legend")
    body = text[start:] if start >= 0 else ""
    body = re.sub(r"(^|[\s`'\"(])/buddy:([a-z][a-z-]*)", r"\1/buddy-\2", body)
    return body.strip()


def legend(buddy: Path, project: Path, sid: str) -> str:
    from scripts.specialist_labels import resolve_labels

    active_lines = "(none)"
    state_path = project / ".buddy" / sid / "state.json" if sid else None
    if not sid:
        active_lines = "(no active session)"
    elif state_path.is_file():
        from scripts.state import load_state

        # load_state, as status() reads it: a file from another STATE_VERSION reads as the
        # defaults in both dialogs. Raw json.loads listed that file's specialists here while
        # /buddy-status said "(none)".
        active = load_state(state_path).get("active_specialists") or []
        if active:
            pairs = resolve_labels(active, plugin_root=buddy, project_root=project)
            active_lines = "\n".join(f"- {label} ({slug})" for slug, label in pairs)
    body = _legend_static(buddy)
    placeholder = re.compile(r"<output of Step 1[^>]*>")
    if placeholder.search(body):
        return placeholder.sub(lambda _m: active_lines, body)
    return f"Currently active:\n{active_lines}\n\n{body}"


def main(argv: list[str]) -> int:
    if len(argv) < 5 or argv[1] not in ("status", "legend"):
        print(next(ln for ln in __doc__.splitlines() if ln.startswith("usage:")))
        return 0
    kind, buddy, project, sid = argv[1], Path(argv[2]), Path(argv[3]), argv[4]
    if str(buddy) not in sys.path:
        sys.path.insert(0, str(buddy))
    try:
        from scripts.buddy_paths import resolve_project_root
        project = resolve_project_root(str(project))
    except Exception:
        pass
    try:
        print(status(buddy, project, sid) if kind == "status" else legend(buddy, project, sid))
    except Exception as e:  # a report must never crash the TUI's dialog
        print(f"buddy {kind}: failed — {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
