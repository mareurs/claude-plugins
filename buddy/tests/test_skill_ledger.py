"""Tests for skill_ledger.py — transcript scan, ledger upsert, advisories."""
import json
import shutil
from pathlib import Path

from scripts.buddy_paths import event_project_dir
from scripts.skill_ledger import (
    ledger_path,
    load_ledger,
    loaded_skills,
    read_ledger,
    scan_from_event,
    scan_transcript,
)
from scripts.statusline import parse_stdin_session


def _tool_use_line(skill: str) -> str:
    return json.dumps({
        "type": "assistant",
        "message": {"content": [
            {"type": "tool_use", "name": "Skill", "input": {"skill": skill}},
        ]},
    })


def _command_line(command: str) -> str:
    return json.dumps({
        "type": "user",
        "message": {"content": f"<command-name>{command}</command-name> rest"},
    })


def _write_transcript(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_skill_tool_use_recorded(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_tool_use_line("codescout-companion:reconnaissance")])

    advisories = scan_transcript(transcript, ledger_file, ts=100)
    assert advisories == []  # first load is silent
    ledger = load_ledger(ledger_file)
    assert ledger["skills"]["codescout-companion:reconnaissance"]["count"] == 1


def test_repeat_load_emits_advisory(tmp_path):
    # Cross-chunk repeat → advisory (deduped within the chunk). Same-chunk
    # repeats stay silent — see test_same_chunk_repeats_stay_silent.
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_tool_use_line("a:b")])
    scan_transcript(transcript, ledger_file)

    with open(transcript, "a", encoding="utf-8") as f:
        f.write(_tool_use_line("a:b") + "\n")
        f.write(_tool_use_line("a:b") + "\n")
    advisories = scan_transcript(transcript, ledger_file)
    assert len(advisories) == 1
    assert "a:b" in advisories[0]
    assert "already loaded" in advisories[0]


def test_same_chunk_repeats_stay_silent(tmp_path):
    # Initial full scan: replay echoes (e.g. compact summaries quoting the
    # conversation) may repeat a load — counts grow, but NO advisory fires
    # because nothing pre-existed the chunk (observed live 2026-06-12:
    # one recon invocation → two transcript occurrences after compact).
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_tool_use_line("a:b"), _tool_use_line("a:b")])

    advisories = scan_transcript(transcript, ledger_file)
    assert advisories == []
    assert load_ledger(ledger_file)["skills"]["a:b"]["count"] == 2


def test_tool_use_buddy_skills_excluded(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [
        _tool_use_line("buddy:summon"),
        _tool_use_line("buddy:prompt-hamsa"),
        _tool_use_line("a:b"),
    ])
    scan_transcript(transcript, ledger_file)
    assert list(load_ledger(ledger_file)["skills"]) == ["a:b"]


def test_compact_summary_and_meta_lines_skipped(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    summary = json.loads(_command_line("/x:y"))
    summary["isCompactSummary"] = True
    meta = json.loads(_tool_use_line("a:b"))
    meta["isMeta"] = True
    other_type = json.loads(_tool_use_line("c:d"))
    other_type["type"] = "summary"
    _write_transcript(transcript, [
        json.dumps(summary), json.dumps(meta), json.dumps(other_type),
    ])
    scan_transcript(transcript, ledger_file)
    assert load_ledger(ledger_file)["skills"] == {}


def test_offset_persists_no_rescan(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_tool_use_line("a:b")])
    scan_transcript(transcript, ledger_file)

    # second scan with no new bytes: count must not grow
    scan_transcript(transcript, ledger_file)
    assert load_ledger(ledger_file)["skills"]["a:b"]["count"] == 1

    # append a new load: only the delta is scanned → count 2, advisory fires
    with open(transcript, "a", encoding="utf-8") as f:
        f.write(_tool_use_line("a:b") + "\n")
    advisories = scan_transcript(transcript, ledger_file)
    assert load_ledger(ledger_file)["skills"]["a:b"]["count"] == 2
    assert len(advisories) == 1


def test_rotation_resets_offset(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_tool_use_line("a:b"), _tool_use_line("c:d")])
    scan_transcript(transcript, ledger_file)

    # transcript rewritten shorter (compact) — offset > size triggers rescan
    _write_transcript(transcript, [_tool_use_line("e:f")])
    scan_transcript(transcript, ledger_file)
    assert "e:f" in load_ledger(ledger_file)["skills"]


def test_command_name_detection_excludes_buddy(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [
        _command_line("/codescout-companion:reconnaissance"),
        _command_line("/buddy:summon"),
        _command_line("/compact"),  # no colon → not skill-shaped
    ])

    scan_transcript(transcript, ledger_file)
    skills = load_ledger(ledger_file)["skills"]
    assert list(skills) == ["codescout-companion:reconnaissance"]


def test_malformed_lines_ignored(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, ['not json {', _tool_use_line("a:b")])

    scan_transcript(transcript, ledger_file)
    assert load_ledger(ledger_file)["skills"]["a:b"]["count"] == 1


def test_missing_transcript_is_silent(tmp_path):
    assert scan_transcript(tmp_path / "absent.jsonl", tmp_path / "l.json") == []


def test_scan_from_event_end_to_end(tmp_path):
    transcript = tmp_path / "t.jsonl"
    _write_transcript(transcript, [_tool_use_line("x:y")])
    event = {
        "transcript_path": str(transcript),
        "cwd": str(tmp_path),
        "session_id": "sid-1",
        "timestamp": 5,
    }
    assert scan_from_event(event) == []
    assert loaded_skills(tmp_path, "sid-1") == ["x:y"]
    assert ledger_path(tmp_path, "sid-1").is_file()


def test_scan_from_event_missing_fields_silent():
    assert scan_from_event({}) == []


# --- worktree residue: writer must not resurrect a deleted root, and the
# writer and the statusline reader must resolve the same directory ---------


def _stamped_tool_use_line(skill: str, iso_ts: str) -> str:
    return json.dumps({
        "type": "assistant",
        "timestamp": iso_ts,
        "message": {"content": [
            {"type": "tool_use", "name": "Skill", "input": {"skill": skill}},
        ]},
    })


def test_scan_from_event_does_not_recreate_a_deleted_root(tmp_path):
    root = tmp_path / "wt"
    root.mkdir()
    transcript = tmp_path / "t.jsonl"
    _write_transcript(transcript, [_tool_use_line("x:y")])
    shutil.rmtree(root)  # the worktree was removed while the session lives on
    event = {
        "transcript_path": str(transcript),
        "cwd": str(root),
        "session_id": "sid-1",
        "timestamp": 5,
    }
    assert scan_from_event(event) == []
    assert not root.exists(), "the writer recreated a deleted project root"


def test_writer_and_statusline_resolve_the_same_root(tmp_path):
    # workspace.current_dir and cwd disagree: both sides must pick current_dir.
    ws, other = tmp_path / "ws", tmp_path / "other"
    ws.mkdir()
    other.mkdir()
    transcript = tmp_path / "t.jsonl"
    _write_transcript(transcript, [_tool_use_line("x:y")])
    payload = {
        "transcript_path": str(transcript),
        "session_id": "sid-1",
        "workspace": {"current_dir": str(ws)},
        "cwd": str(other),
        "timestamp": 5,
    }
    assert event_project_dir(payload) == str(ws)
    scan_from_event(payload)
    assert not (other / ".buddy").exists()
    sid, root = parse_stdin_session(json.dumps(payload))
    assert (sid, root) == ("sid-1", ws)
    assert loaded_skills(root, sid) == ["x:y"]


def test_event_project_dir_falls_back_to_cwd():
    assert event_project_dir({"cwd": "/a"}) == "/a"
    assert event_project_dir({"workspace": None, "cwd": "/a"}) == "/a"
    assert event_project_dir({"workspace": {"current_dir": ""}, "cwd": "/a"}) == "/a"
    assert event_project_dir({}) is None


def test_read_ledger_distinguishes_absent_from_empty(tmp_path):
    absent = tmp_path / "absent.json"
    assert read_ledger(absent) is None
    assert load_ledger(absent)["skills"] == {}  # legacy callers keep a default
    empty = tmp_path / "empty.json"
    empty.write_text(
        json.dumps({"version": 1, "transcript_offset": 0, "skills": {}}),
        encoding="utf-8",
    )
    assert read_ledger(empty) == {"version": 1, "transcript_offset": 0, "skills": {}}
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert read_ledger(corrupt) is None


def test_absent_ledger_does_not_restamp_first_seen_as_now(tmp_path):
    # A ledger that has to be rebuilt from the transcript (moved root, deleted
    # file) must take first-seen from the transcript's own timestamps, not from
    # the write instant.
    transcript = tmp_path / "t.jsonl"
    _write_transcript(transcript, [
        _stamped_tool_use_line("a:one", "2026-09-09T09:06:44.000Z"),
        _stamped_tool_use_line("b:two", "2026-09-09T09:23:34.000Z"),
    ])
    ledger_file = tmp_path / "ledger.json"
    now = 1789119492  # 2026-09-11
    scan_transcript(transcript, ledger_file, ts=now)
    skills = load_ledger(ledger_file)["skills"]
    assert skills["a:one"]["first_ts"] == 1788944804
    assert skills["b:two"]["first_ts"] == 1788945814
    assert skills["a:one"]["first_ts"] != skills["b:two"]["first_ts"]
    assert now not in {e["first_ts"] for e in skills.values()}


def test_existing_first_seen_survives_a_later_scan(tmp_path):
    transcript = tmp_path / "t.jsonl"
    ledger_file = tmp_path / "ledger.json"
    _write_transcript(transcript, [_stamped_tool_use_line("a:one", "2026-09-09T09:06:44Z")])
    scan_transcript(transcript, ledger_file, ts=1)
    with open(transcript, "a", encoding="utf-8") as f:
        f.write(_stamped_tool_use_line("a:one", "2026-09-11T12:00:00Z") + "\n")
    scan_transcript(transcript, ledger_file, ts=2)
    entry = load_ledger(ledger_file)["skills"]["a:one"]
    assert entry["first_ts"] == 1788944804
    assert entry["count"] == 2
