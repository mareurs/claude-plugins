"""Session ledger of loaded skills — the certain record behind statusline + dedup.

Two load classes, two sources of truth:

- **Buddy summons** are recorded hook-side by ``summon_bootstrap`` into
  ``state.json:active_specialists`` (zero lag, deterministic). They do NOT
  appear in this ledger — the statusline already renders them.
- **Skill-tool loads** (``Skill('plugin:skill')``) fire no hooks
  (anthropics/claude-code#43630), so the only ground truth is the transcript
  JSONL the harness writes. ``scan_transcript`` tail-reads it from a saved
  byte offset on each UserPromptSubmit and records:
    * assistant ``tool_use`` entries with ``name == "Skill"`` → ``input.skill``
    * ``<command-name>plugin:skill</command-name>`` user invocations
      (plugin-namespaced only)
  ``buddy:*`` is excluded on both paths — buddy commands are not skills and
  persona loads are tracked in state.json by the summon bootstrap. Compact
  summaries / meta lines are skipped (they replay earlier content), and
  advisories fire only for cross-chunk repeats — see ``scan_transcript``.

Ledger file: ``.buddy/<sid>/loaded_skills.json``::

    {"version": 1, "transcript_offset": N,
     "skills": {"<id>": {"first_ts": N, "count": N}}}

Lag note: a Skill-tool load becomes visible at the *next* prompt submit.
Silent on all failures — the ledger is advisory, never breaks a turn.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from scripts.buddy_paths import event_project_dir

LEDGER_FILENAME = "loaded_skills.json"

_COMMAND_RE = re.compile(r"<command-name>/?([a-z0-9-]+:[a-z0-9_:-]+)</command-name>")


def ledger_path(project_root: Path, session_id: str) -> Path:
    return project_root / ".buddy" / session_id / LEDGER_FILENAME


def read_ledger(path: Path) -> "dict | None":
    """The ledger at *path*, or None when there is no readable one.

    None means "absent or unreadable" — NOT "this session has loaded no skills".
    Those are different facts: an empty ledger is a record, a missing file only
    says we looked in a place where nothing was written. Callers that would
    otherwise treat a miss as "nothing seen yet" must handle None explicitly.
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if isinstance(data, dict) and isinstance(data.get("skills"), dict):
        data.setdefault("version", 1)
        data.setdefault("transcript_offset", 0)
        return data
    return None


def load_ledger(path: Path) -> dict:
    """Like `read_ledger`, but an absent ledger reads as an empty one."""
    data = read_ledger(path)
    if data is not None:
        return data
    return {"version": 1, "transcript_offset": 0, "skills": {}}


def save_ledger(path: Path, ledger: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(ledger, indent=1), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


def _skill_ids_in_line(line: str) -> list[str]:
    """Extract skill identifiers from one transcript JSONL line.

    Only genuine conversation lines count: compact summaries and meta lines
    replay earlier content verbatim and would double-count loads (observed
    live 2026-06-12: one recon invocation → two transcript occurrences).
    buddy:* is excluded on BOTH paths — buddy commands are not skills, and
    persona loads are tracked in state.json by the summon bootstrap.
    """
    out: list[str] = []
    if '"Skill"' not in line and "<command-name>" not in line:
        return out
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return out
    if obj.get("type") not in ("user", "assistant"):
        return out
    if obj.get("isCompactSummary") or obj.get("isMeta"):
        return out
    message = obj.get("message")
    if not isinstance(message, dict):
        return out
    content = message.get("content")
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use" and item.get("name") == "Skill":
                skill = (item.get("input") or {}).get("skill")
                if isinstance(skill, str) and skill:
                    skill = skill.lstrip("/")
                    if not skill.startswith("buddy:"):
                        out.append(skill)
            elif item.get("type") == "text":
                out.extend(_command_skills(item.get("text") or ""))
    elif isinstance(content, str):
        out.extend(_command_skills(content))
    return out


def _line_epoch(line: str) -> "int | None":
    """Epoch seconds from a transcript line's own ISO `timestamp`, else None.

    First-seen must come from the transcript, not from the moment a scan runs:
    a ledger rebuilt from zero (moved root, deleted file) would otherwise stamp
    every skill it finds with the rebuild instant — a complete, plausible, wrong
    record rather than an error.
    """
    try:
        raw = json.loads(line).get("timestamp")
        if not isinstance(raw, str):
            return None
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except (json.JSONDecodeError, ValueError, TypeError, AttributeError, OverflowError, OSError):
        return None


def _command_skills(text: str) -> list[str]:
    """Plugin-namespaced <command-name> invocations, excluding buddy:* commands."""
    return [
        m for m in _COMMAND_RE.findall(text)
        if not m.startswith("buddy:")
    ]


def scan_transcript(
    transcript_path: Path,
    ledger_file: Path,
    *,
    ts: int = 0,
) -> list[str]:
    """Scan new transcript bytes; update the ledger; return advisory lines.

    Advisory rule: a skill must have been in the ledger BEFORE this scan
    chunk to trigger one — a genuine re-invocation across prompts. Multiple
    occurrences inside a single chunk (initial full scan, compact-replay
    echoes) inflate the count but stay silent: on a from-zero scan nothing
    pre-exists, so replays can never produce a false advisory.
    """
    advisories: list[str] = []
    try:
        size = transcript_path.stat().st_size
    except OSError:
        return advisories

    ledger = read_ledger(ledger_file)
    if ledger is None:
        # Absent, not empty: a from-zero rebuild. `ts` is the write instant, which
        # is NOT when these skills were first seen — the transcript knows that.
        ledger = {"version": 1, "transcript_offset": 0, "skills": {}}
    offset = int(ledger.get("transcript_offset", 0) or 0)
    if offset > size:
        offset = 0  # transcript rotated/rewritten (e.g. compact) — rescan

    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as f:
            f.seek(offset)
            chunk = f.read()
            new_offset = f.tell()
    except OSError:
        return advisories

    pre_existing = set(ledger["skills"]) if offset > 0 else set()
    changed = new_offset != offset
    advised: set[str] = set()
    for line in chunk.splitlines():
        skill_ids = _skill_ids_in_line(line)
        if not skill_ids:
            continue
        seen = _line_epoch(line)
        if seen is None:
            seen = ts  # line carries no timestamp (synthetic transcripts only)
        for skill in skill_ids:
            entry = ledger["skills"].setdefault(
                skill, {"first_ts": seen, "count": 0}
            )
            entry["count"] = int(entry.get("count", 0)) + 1
            if skill in pre_existing and skill not in advised:
                advised.add(skill)
                advisories.append(
                    f"→ skill `{skill}` already loaded this session "
                    f"(seen {entry['count']}×) — do not re-invoke; "
                    "its instructions are still in context."
                )

    ledger["transcript_offset"] = new_offset
    if changed:
        save_ledger(ledger_file, ledger)
    return advisories


def loaded_skills(project_root: Path, session_id: str) -> list[str]:
    """Skill ids recorded for this session, insertion-ordered (for statusline)."""
    ledger = load_ledger(ledger_path(project_root, session_id))
    return list(ledger.get("skills", {}).keys())


def scan_from_event(event: dict) -> list[str]:
    """Hook entry point: scan using a UserPromptSubmit event's fields.

    The ledger root is `event_project_dir(event)` — the same rule the statusline
    reader uses. A root that no longer exists (a removed worktree whose session
    is still alive) is refused: `.buddy/<sid>/` is only ever created beneath a
    directory that is already there, so removing a worktree stays removed.
    """
    try:
        transcript = event.get("transcript_path")
        root = event_project_dir(event)
        sid = event.get("session_id")
        if not (transcript and root and sid):
            return []
        project_root = Path(root)
        if not project_root.is_dir():
            return []
        return scan_transcript(
            Path(transcript),
            ledger_path(project_root, sid),
            ts=int(event.get("timestamp") or 0),
        )
    except Exception:
        return []
