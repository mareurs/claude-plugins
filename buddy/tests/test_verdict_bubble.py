import json
import os
from pathlib import Path
from unittest.mock import patch

from scripts.verdicts import fresh_verdict, _bubble_ttl, write_verdict


def make_verdict(ts, severity="warning", verdict="plan-drift",
                 correction="do this thing", evidence="ev"):
    return {
        "ts": ts,
        "verdict": verdict,
        "severity": severity,
        "evidence": evidence,
        "correction": correction,
        "affected_files": [],
        "acknowledged": False,
    }


def test_fresh_verdict_missing_file(tmp_path):
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_corrupted_file(tmp_path):
    (tmp_path / "verdicts.json").write_text("{not json")
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_empty_active(tmp_path):
    (tmp_path / "verdicts.json").write_text(
        json.dumps({"session_id": "x", "active_verdicts": []})
    )
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_returns_latest_within_ttl(tmp_path):
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=95), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    assert result is not None
    latest, count = result
    assert latest["ts"] == 95
    assert count == 1


def test_fresh_verdict_expired_outside_ttl(tmp_path):
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=80), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is None


def test_fresh_verdict_ttl_boundary_exact(tmp_path):
    """ts exactly at the TTL edge is still fresh (now - ts == ttl)."""
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=90), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is not None


def test_fresh_verdict_ttl_boundary_just_past(tmp_path):
    """One second past TTL is stale (now - ts == ttl + 1)."""
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=89), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is None


def test_fresh_verdict_multi_verdict_count(tmp_path):
    p = tmp_path / "verdicts.json"
    write_verdict(p, make_verdict(ts=95, correction="first"), session_id="x")
    write_verdict(p, make_verdict(ts=96, correction="second"), session_id="x")
    write_verdict(p, make_verdict(ts=97, correction="third"), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    latest, count = result
    assert latest["correction"] == "third"
    assert count == 3


def test_fresh_verdict_mixed_fresh_and_stale(tmp_path):
    p = tmp_path / "verdicts.json"
    write_verdict(p, make_verdict(ts=80, correction="stale"), session_id="x")
    write_verdict(p, make_verdict(ts=95, correction="fresh"), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    latest, count = result
    assert latest["correction"] == "fresh"
    assert count == 1


def test_bubble_ttl_default():
    with patch.dict(os.environ, {}, clear=True):
        assert _bubble_ttl() == 10


def test_bubble_ttl_env_override():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "20"}):
        assert _bubble_ttl() == 20


def test_bubble_ttl_clamped_low():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "0"}):
        assert _bubble_ttl() == 3


def test_bubble_ttl_clamped_high():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "1000"}):
        assert _bubble_ttl() == 60


def test_bubble_ttl_invalid_falls_back():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "not-a-number"}):
        assert _bubble_ttl() == 10
