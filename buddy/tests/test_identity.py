"""Tests for identity.py — identity.json load with deterministic fallback."""
import json
from pathlib import Path

from scripts.identity import load_identity, fallback_name, IDENTITY_VERSION
from scripts.bones import FORMS


def test_load_identity_missing_returns_fallback(tmp_path):
    path = tmp_path / "identity.json"
    identity = load_identity(path, user_id="alice")
    assert identity["form"] in FORMS
    assert identity["name"]
    assert identity["personality"]
    assert identity["version"] == IDENTITY_VERSION
    assert identity["hatched"] is False


def test_load_identity_deterministic_fallback(tmp_path):
    path = tmp_path / "identity.json"
    i1 = load_identity(path, user_id="alice")
    i2 = load_identity(path, user_id="alice")
    assert i1["form"] == i2["form"]
    assert i1["name"] == i2["name"]


def test_load_identity_from_existing_file(tmp_path):
    path = tmp_path / "identity.json"
    stored = {
        "version": IDENTITY_VERSION,
        "form": "doe-of-gentle-attention",
        "name": "Lin",
        "personality": "a quiet watcher",
        "hatched_at": 123456,
        "soul_model": "claude-opus-4-6",
    }
    path.write_text(json.dumps(stored))
    identity = load_identity(path, user_id="alice")
    assert identity["name"] == "Lin"
    assert identity["hatched"] is True


def test_fallback_name_deterministic():
    assert fallback_name("owl-of-clear-seeing", "alice") == fallback_name(
        "owl-of-clear-seeing", "alice"
    )
