"""Integration smoke test: session-start hook (hook_dispatch.py) auto-migration wiring.

Runs the real hook via subprocess with a temp HOME + BUDDY_HOME so it cannot
touch the developer's real ~/.claude*/buddy dirs. Catches heredoc/sys.path
typos that unit tests on auto_migrate_if_needed() cannot.
"""
import json
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent  # buddy/
DISPATCH = PLUGIN_ROOT / "hooks" / "hook_dispatch.py"


def test_session_start_migrates_legacy_profile(tmp_path):
    home = tmp_path / "home"
    legacy = home / ".claude-sdd" / "buddy" / "skills" / "codescout-pika"
    legacy.mkdir(parents=True)
    (legacy / "SKILL.md").write_text("pika\n")
    dest = tmp_path / "dest"

    env = {
        "HOME": str(home),
        "BUDDY_HOME": str(dest),
        "PATH": __import__("os").environ["PATH"],
    }
    result = subprocess.run(
        [sys.executable, str(DISPATCH), "session-start"],
        input=json.dumps({"cwd": str(tmp_path), "session_id": "smoke"}),
        capture_output=True, text=True, env=env, cwd=str(tmp_path),
    )
    assert result.returncode == 0, result.stderr
    assert "migrated" in result.stdout
    # data merged into dest, source artifact deleted
    assert (dest / "skills" / "codescout-pika" / "SKILL.md").read_text() == "pika\n"
    assert not (home / ".claude-sdd" / "buddy" / "skills").exists()


def test_session_start_noop_when_no_legacy_state(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    dest = tmp_path / "dest"
    env = {
        "HOME": str(home),
        "BUDDY_HOME": str(dest),
        "PATH": __import__("os").environ["PATH"],
    }
    result = subprocess.run(
        [sys.executable, str(DISPATCH), "session-start"],
        input=json.dumps({"cwd": str(tmp_path), "session_id": "smoke"}),
        capture_output=True, text=True, env=env, cwd=str(tmp_path),
    )
    assert result.returncode == 0, result.stderr
    assert "migrated" not in result.stdout
