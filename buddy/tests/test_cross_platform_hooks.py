"""Cross-platform portability guards for hook_helpers.

Regression tests for the Windows-safety fixes: the module must import without
fcntl, the detached-spawn helper must pick the right OS-specific kwargs, the
worker spawn must use the running interpreter (not a literal "python3"), and the
advisory lock must be mutually exclusive.
"""
import os
import subprocess
import sys
from pathlib import Path

import scripts.hook_helpers as hh

BUDDY_ROOT = Path(hh.__file__).parent.parent


def test_imports_without_fcntl():
    # Simulate Windows (no fcntl) in a clean interpreter; the module must still import.
    code = (
        "import sys; sys.modules['fcntl'] = None;"
        "import scripts.hook_helpers as hh;"
        "assert hh.fcntl is None;"
        "print('ok')"
    )
    r = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(BUDDY_ROOT),
        env={**os.environ, "PYTHONPATH": str(BUDDY_ROOT)},
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert "ok" in r.stdout


def test_spawn_detached_posix_uses_new_session(monkeypatch):
    captured = {}
    monkeypatch.setattr(hh.subprocess, "Popen", lambda a, **k: captured.update(kwargs=k))
    monkeypatch.setattr(hh.os, "name", "posix")
    hh._spawn_detached_worker(["x"], cwd="/", env={})
    assert captured["kwargs"].get("start_new_session") is True
    assert "creationflags" not in captured["kwargs"]


def test_spawn_detached_windows_uses_creationflags(monkeypatch):
    captured = {}
    monkeypatch.setattr(hh.subprocess, "Popen", lambda a, **k: captured.update(kwargs=k))
    monkeypatch.setattr(hh.os, "name", "nt")
    # These constants exist only on Windows; inject them so the nt branch runs on Linux CI.
    monkeypatch.setattr(hh.subprocess, "DETACHED_PROCESS", 0x8, raising=False)
    monkeypatch.setattr(hh.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, raising=False)
    hh._spawn_detached_worker(["x"], cwd="/", env={})
    assert captured["kwargs"].get("creationflags") == (0x8 | 0x200)
    assert "start_new_session" not in captured["kwargs"]


def test_no_hardcoded_python3_spawn():
    # The judge spawns must use sys.executable, never a literal "python3".
    src = Path(hh.__file__).read_text()
    assert '"python3"' not in src


def test_exclusive_lock_is_mutually_exclusive(tmp_path):
    lockfile = tmp_path / ".migrate.lock"
    with open(lockfile, "w") as f1:
        assert hh._try_exclusive_lock(f1) is True
        with open(lockfile, "w") as f2:
            assert hh._try_exclusive_lock(f2) is False
