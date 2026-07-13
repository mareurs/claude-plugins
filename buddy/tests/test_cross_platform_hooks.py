"""Cross-platform portability guards for the buddy Python layer.

Regression tests for the Windows-safety fixes across three modules:
- hook_helpers: import without fcntl, OS-specific detached-spawn kwargs, spawn
  via the running interpreter (not a literal "python3"), mutually-exclusive lock.
- state: `pid_started_at` returns None where start-time is unsupported (Windows),
  and the by-ppid resolver trusts the PPID mapping alone there while still
  requiring a start-time match on POSIX.
- judge / cs_judge: LLM calls go through stdlib urllib, with no `requests` dep.
"""
import json
import os
import subprocess
import sys
import urllib.request
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


# --- state: PPID-index start-time portability ---------------------------------

def test_pid_started_at_none_when_start_time_unsupported(monkeypatch):
    # On platforms without process start-time support (e.g. Windows), the lookup
    # short-circuits to None even for a live pid — no `ps` subprocess is spawned.
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", False)
    assert state.pid_started_at(os.getpid()) is None


def test_resolve_trusts_ppid_alone_when_start_time_unsupported(monkeypatch, tmp_path):
    # Windows path: no started_at file exists at all, yet the session must resolve
    # from the PPID mapping alone.
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", False)
    ppid = 4242
    ppid_dir = tmp_path / ".buddy" / "by-ppid" / str(ppid)
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sess-windows\n")
    assert state.resolve_session_id_for_command(tmp_path, ppid) == "sess-windows"


def test_resolve_accepts_matching_start_time_when_supported(monkeypatch, tmp_path):
    # POSIX path: a matching stored start-time resolves the session.
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", True)
    monkeypatch.setattr(state, "pid_started_at", lambda pid: "MATCHING")
    ppid = 4242
    ppid_dir = tmp_path / ".buddy" / "by-ppid" / str(ppid)
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sess-posix\n")
    (ppid_dir / "started_at").write_text("MATCHING\n")
    assert state.resolve_session_id_for_command(tmp_path, ppid) == "sess-posix"


def test_resolve_rejects_mismatched_start_time_when_supported(monkeypatch, tmp_path):
    # POSIX regression guard: a stale (mismatched) start-time must NOT resolve via
    # the by-ppid index — PID-reuse safety is preserved. With no pointer/lone-dir
    # fallback present, resolution is None.
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", True)
    monkeypatch.setattr(state, "pid_started_at", lambda pid: "A DIFFERENT TIME")
    ppid = 4242
    ppid_dir = tmp_path / ".buddy" / "by-ppid" / str(ppid)
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sess-stale\n")
    (ppid_dir / "started_at").write_text("OLD TIME\n")
    assert state.resolve_session_id_for_command(tmp_path, ppid) is None


# --- judge / cs_judge: stdlib urllib, no `requests` dependency -----------------

def test_judge_modules_use_urllib_not_requests():
    import scripts.judge as judge
    import scripts.cs_judge as cs_judge
    for mod in (judge, cs_judge):
        src = Path(mod.__file__).read_text()
        assert "import requests" not in src, f"{mod.__name__} still imports requests"
        assert "requests." not in src, f"{mod.__name__} still calls requests.*"
        assert "urllib.request" in src, f"{mod.__name__} should use urllib.request"


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_call_judge_llm_posts_via_urllib(monkeypatch):
    import scripts.judge as judge
    monkeypatch.setenv("BUDDY_JUDGE_API_URL", "http://example.test/v1")
    monkeypatch.setenv("BUDDY_JUDGE_MODEL", "test-model")
    monkeypatch.setenv("BUDDY_JUDGE_API_KEY", "secret")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["auth"] = req.headers.get("Authorization")
        captured["timeout"] = timeout
        return _FakeResp({"choices": [{"message": {"content": "VERDICT-OK"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = judge.call_judge_llm("hello")

    assert out == "VERDICT-OK"
    assert captured["url"] == "http://example.test/v1/chat/completions"
    assert captured["method"] == "POST"
    assert captured["body"]["model"] == "test-model"
    assert captured["auth"] == "Bearer secret"
    assert captured["timeout"] == 30


def test_call_cs_judge_llm_posts_via_urllib(monkeypatch):
    import scripts.cs_judge as cs_judge
    monkeypatch.setenv("BUDDY_JUDGE_API_URL", "http://example.test/v1/")
    monkeypatch.setenv("BUDDY_JUDGE_MODEL", "cs-model")
    monkeypatch.delenv("BUDDY_JUDGE_API_KEY", raising=False)
    monkeypatch.setattr(cs_judge, "load_rules", lambda: "RULES")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["auth"] = req.headers.get("Authorization")
        return _FakeResp({"choices": [{"message": {"content": "CS-OK"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = cs_judge.call_cs_judge_llm("hi")

    assert out == "CS-OK"
    # trailing slash on the base URL must not double up
    assert captured["url"] == "http://example.test/v1/chat/completions"
    assert captured["method"] == "POST"
    # no API key set → no Authorization header
    assert captured["auth"] is None
