"""Tests for buddy_paths — resolved global-state locations."""
from pathlib import Path

from scripts import buddy_paths


def test_default_root_is_home_dot_buddy(monkeypatch, tmp_path):
    monkeypatch.delenv("BUDDY_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert buddy_paths.global_root() == tmp_path / ".buddy"


def test_buddy_home_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "custom"))
    assert buddy_paths.global_root() == tmp_path / "custom"


def test_buddy_home_expands_user(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BUDDY_HOME", "~/elsewhere")
    assert buddy_paths.global_root() == tmp_path / "elsewhere"


def test_accessors_compose_on_root(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "b"))
    root = tmp_path / "b"
    assert buddy_paths.global_skills() == root / "skills"
    assert buddy_paths.global_memory() == root / "memory"
    assert buddy_paths.summons_log() == root / "summons.log"
    assert buddy_paths.identity_path() == root / "identity.json"
