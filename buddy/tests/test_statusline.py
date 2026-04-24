"""Golden-file tests for statusline rendering."""
import json
from pathlib import Path

from scripts.statusline import render
from scripts.state import default_state
from scripts.identity import load_identity

DATA_DIR = Path(__file__).parent.parent / "data"
BODHIS = json.loads((DATA_DIR / "bodhisattvas.json").read_text())
ENV = json.loads((DATA_DIR / "environment.json").read_text())


def test_render_contains_label_and_form():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "quiet watcher",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)

    assert "Owl" in output
    assert "flow" in output


def test_render_substitutes_eyes_for_mood():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["signals"]["last_test_result"] = {"ts": 999940, "passed": 0, "failed": 4}
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)

    expected_eyes = BODHIS["owl-of-clear-seeing"]["eyes"]["stuck"]
    assert expected_eyes in output


def test_render_substitutes_environment_for_mood():
    identity = {
        "version": 1,
        "form": "doe-of-gentle-attention",
        "name": "Mei",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=23)

    assert ENV["late-night"].strip() in output


def test_render_shows_suggested_specialist_hint():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["signals"]["last_test_result"] = {"ts": 999940, "passed": 0, "failed": 4}
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)

    assert "yeti" in output.lower()


def test_render_never_raises_on_unknown_form():
    identity = {
        "version": 1,
        "form": "unknown-form",
        "name": "Ghost",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert isinstance(output, str)


def test_render_derives_mood_when_only_signals_set():
    """statusline must compute mood from signals, not just echo derived_mood."""
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["signals"]["context_pct"] = 85  # should trigger full-context mood
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV)
    assert "full-context" in output


def test_render_shows_active_specialist_initial():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["active_specialists"] = ["debugging-yeti"]
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[D]" in output


def test_render_shows_multiple_active_specialists_initials():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["active_specialists"] = ["debugging-yeti", "testing-snow-leopard"]
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[DT]" in output


def test_render_no_initials_when_no_active_specialists():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[" not in output.split("\n")[-1]


import subprocess
import sys as _sys

from scripts.statusline import parse_stdin_context_pct


def test_parse_stdin_context_pct_from_valid_session_json():
    raw = '{"context_window": {"used_percentage": 85}}'
    assert parse_stdin_context_pct(raw) == 85.0


def test_parse_stdin_context_pct_returns_zero_on_missing_field():
    raw = '{"model": {"display_name": "opus"}}'
    assert parse_stdin_context_pct(raw) == 0.0


def test_parse_stdin_context_pct_returns_zero_on_malformed_json():
    assert parse_stdin_context_pct("{not json") == 0.0
    assert parse_stdin_context_pct("") == 0.0


def test_parse_stdin_context_pct_handles_null():
    raw = '{"context_window": {"used_percentage": null}}'
    assert parse_stdin_context_pct(raw) == 0.0


def test_main_parses_context_pct_from_stdin():
    """Feeding session JSON with high context_pct on stdin should yield full-context mood."""
    raw = '{"context_window": {"used_percentage": 85}}'
    repo_root = Path(__file__).parent.parent
    result = subprocess.run(
        [_sys.executable, str(repo_root / "scripts" / "statusline.py")],
        input=raw,
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 0
    assert "full-context" in result.stdout


import os
import json as _json
from unittest.mock import patch

from scripts.statusline import parse_stdin_session, _render_bubble
from scripts.verdicts import write_verdict


def _identity():
    return {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }


def test_parse_stdin_session_happy_path():
    raw = _json.dumps({
        "session_id": "abc-123",
        "workspace": {"current_dir": "/home/user/proj"},
    })
    sid, root = parse_stdin_session(raw)
    assert sid == "abc-123"
    assert root == Path("/home/user/proj")


def test_parse_stdin_session_cwd_fallback():
    raw = _json.dumps({"session_id": "abc", "cwd": "/tmp/x"})
    sid, root = parse_stdin_session(raw)
    assert root == Path("/tmp/x")


def test_parse_stdin_session_malformed():
    sid, root = parse_stdin_session("not json")
    assert sid is None
    assert root is None


def test_parse_stdin_session_missing_keys():
    sid, root = parse_stdin_session("{}")
    assert sid is None
    assert root is None


def test_render_bubble_no_session():
    assert _render_bubble(None, Path("/x"), 100) == ""


def test_render_bubble_unknown_session():
    assert _render_bubble("unknown", Path("/x"), 100) == ""


def test_render_bubble_no_project_root():
    assert _render_bubble("sess", None, 100) == ""


def test_render_bubble_no_verdicts(tmp_path):
    (tmp_path / ".buddy" / "sess-1").mkdir(parents=True)
    assert _render_bubble("sess-1", tmp_path, 100) == ""


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_fresh_verdict(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 95,
            "verdict": "plan-drift",
            "severity": "warning",
            "evidence": "ev",
            "correction": "go back to step 2",
            "affected_files": [],
            "acknowledged": False,
        },
        session_id="sess-1",
    )
    out = _render_bubble("sess-1", tmp_path, 100)
    assert "[!]" in out
    assert "plan-drift" in out
    assert "go back to step 2" in out
    assert "\033[33m" in out  # warning color
    assert "\033[0m" in out   # RESET preserved


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_expired(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 50,
            "verdict": "plan-drift",
            "severity": "warning",
            "evidence": "ev",
            "correction": "stale advice",
            "affected_files": [],
            "acknowledged": False,
        },
        session_id="sess-1",
    )
    assert _render_bubble("sess-1", tmp_path, 100) == ""


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_multi_count(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    p = session_dir / "verdicts.json"
    for ts in (95, 96, 97):
        write_verdict(p, {
            "ts": ts, "verdict": "plan-drift", "severity": "warning",
            "evidence": "", "correction": "fix", "affected_files": [],
            "acknowledged": False,
        }, session_id="sess-1")
    out = _render_bubble("sess-1", tmp_path, 100)
    assert "(+2)" in out


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_with_session_kwargs_no_bubble_when_no_verdict(tmp_path):
    """End-to-end: session kwargs supplied but no verdicts -> no bubble."""
    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()
    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
        session_id="sess-empty", project_root=tmp_path,
    )
    assert "[!]" not in out
    assert "[ok]" not in out


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_with_session_kwargs_appends_bubble(tmp_path):
    """End-to-end: render() with session kwargs picks up a fresh verdict."""
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 999995, "verdict": "plan-drift", "severity": "warning",
            "evidence": "", "correction": "fix this",
            "affected_files": [], "acknowledged": False,
        },
        session_id="sess-1",
    )

    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()

    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
        session_id="sess-1", project_root=tmp_path,
    )
    assert "fix this" in out
    assert "[!]" in out


def test_render_existing_signature_unchanged(tmp_path):
    """All 9 existing test sites use kwargs only — no bubble without session."""
    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()

    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
    )
    assert "Owl" in out  # bubble absent — no session kwargs passed
