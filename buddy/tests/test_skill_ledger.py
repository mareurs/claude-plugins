"""Tests for skill_ledger.py — transcript scan, ledger upsert, advisories."""
import json
from pathlib import Path

from scripts.skill_ledger import (
    ledger_path,
    load_ledger,
    loaded_skills,
    scan_from_event,
    scan_transcript,
)


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
