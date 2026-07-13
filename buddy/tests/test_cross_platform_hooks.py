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
        # urllib capitalizes header keys: "Content-Type" -> "Content-type".
        captured["ctype"] = req.headers.get("Content-type")
        captured["timeout"] = timeout
        return _FakeResp({"choices": [{"message": {"content": "VERDICT-OK"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = judge.call_judge_llm("hello")

    assert out == "VERDICT-OK"
    assert captured["url"] == "http://example.test/v1/chat/completions"
    assert captured["method"] == "POST"
    assert captured["body"]["model"] == "test-model"
    assert captured["auth"] == "Bearer secret"
    assert captured["ctype"] == "application/json"
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
        captured["ctype"] = req.headers.get("Content-type")
        return _FakeResp({"choices": [{"message": {"content": "CS-OK"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = cs_judge.call_cs_judge_llm("hi")

    assert out == "CS-OK"
    # trailing slash on the base URL must not double up
    assert captured["url"] == "http://example.test/v1/chat/completions"
    assert captured["method"] == "POST"
    assert captured["ctype"] == "application/json"
    # no API key set → no Authorization header
    assert captured["auth"] is None


def test_call_judge_llm_raises_on_http_error(monkeypatch):
    # The requests->urllib swap must preserve the raises-on-failure contract:
    # a non-2xx must propagate (urllib raises HTTPError), never be swallowed.
    import urllib.error
    import pytest
    import scripts.judge as judge
    monkeypatch.setenv("BUDDY_JUDGE_API_URL", "http://example.test/v1")
    monkeypatch.setenv("BUDDY_JUDGE_MODEL", "test-model")

    def boom(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 500, "Server Error", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    with pytest.raises(urllib.error.HTTPError):
        judge.call_judge_llm("hello")


def test_call_cs_judge_llm_raises_on_url_error(monkeypatch):
    # Connection failures (URLError) must also propagate, not be swallowed.
    import urllib.error
    import pytest
    import scripts.cs_judge as cs_judge
    monkeypatch.setenv("BUDDY_JUDGE_API_URL", "http://example.test/v1")
    monkeypatch.setenv("BUDDY_JUDGE_MODEL", "cs-model")
    monkeypatch.setattr(cs_judge, "load_rules", lambda: "RULES")

    def boom(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    with pytest.raises(urllib.error.URLError):
        cs_judge.call_cs_judge_llm("hi")


def test_resolve_rejects_dead_pid_when_supported(monkeypatch, tmp_path):
    # POSIX: a by-ppid entry whose pid is gone (pid_started_at -> None) must NOT
    # resolve via the index. Guards the `current_started and ...` truthy check.
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", True)
    monkeypatch.setattr(state, "pid_started_at", lambda pid: None)
    ppid = 4242
    ppid_dir = tmp_path / ".buddy" / "by-ppid" / str(ppid)
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sess-dead\n")
    (ppid_dir / "started_at").write_text("SOME TIME\n")
    assert state.resolve_session_id_for_command(tmp_path, ppid) is None


# --- state: PPID-index write / gc / remove (Python port of the bash blocks) ---

def test_update_ppid_index_writes_pointer_and_entry(tmp_path):
    import scripts.state as state
    ppid = os.getpid()  # a live pid, so start-time is available on POSIX
    state.update_ppid_index(tmp_path, "sid-x", ppid)
    assert (tmp_path / ".buddy" / ".current_session_id").read_text() == "sid-x"
    entry = tmp_path / ".buddy" / "by-ppid" / str(ppid)
    assert (entry / "session_id").read_text() == "sid-x"
    if state._START_TIME_SUPPORTED:
        assert (entry / "started_at").read_text().strip()  # written on POSIX


def test_gc_ppid_index_prunes_stale_keeps_live_and_self(tmp_path, monkeypatch):
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", True)
    # 111 = keep_ppid (skipped), 222 = dead pid, 444 = alive+match, 555 = reused
    monkeypatch.setattr(
        state, "pid_started_at",
        lambda pid: {111: "LIVE", 444: "MATCH", 555: "FRESH"}.get(pid),
    )
    by = tmp_path / ".buddy" / "by-ppid"
    for pid, stored in (("111", "LIVE"), ("222", "OLD"), ("444", "MATCH"), ("555", "STALE")):
        (by / pid).mkdir(parents=True)
        (by / pid / "started_at").write_text(stored)
    state.gc_ppid_index(tmp_path, keep_ppid=111)
    assert (by / "111").is_dir()      # keep_ppid — never touched
    assert not (by / "222").exists()  # dead pid — pruned
    assert (by / "444").is_dir()      # alive + start-time match — kept
    assert not (by / "555").exists()  # alive but start-time drift (reuse) — pruned


def test_gc_ppid_index_noop_when_start_time_unsupported(tmp_path, monkeypatch):
    import scripts.state as state
    monkeypatch.setattr(state, "_START_TIME_SUPPORTED", False)
    by = tmp_path / ".buddy" / "by-ppid" / "999"
    by.mkdir(parents=True)
    (by / "started_at").write_text("whatever")
    state.gc_ppid_index(tmp_path, keep_ppid=111)
    assert by.is_dir()  # cannot verify reuse without start-time → leave entries


def test_remove_ppid_entry(tmp_path):
    import scripts.state as state
    entry = tmp_path / ".buddy" / "by-ppid" / "321"
    entry.mkdir(parents=True)
    (entry / "session_id").write_text("x")
    state.remove_ppid_entry(tmp_path, 321)
    assert not entry.exists()
    state.remove_ppid_entry(tmp_path, 321)  # missing entry → no-op, no raise


# --- hook_helpers: judge.env loader (Python port of `. judge.env`) ------------

def test_load_judge_env_parses_and_respects_override(tmp_path, monkeypatch):
    from scripts.hook_helpers import load_judge_env
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    (hooks / "judge.env").write_text(
        "# comment line\n"
        "\n"
        "export BUDDY_JUDGE_ENABLED=false\n"
        "export BUDDY_JUDGE_MODEL=qwen\n"
        "export BUDDY_JUDGE_API_KEY=\n"
        'export BUDDY_JUDGE_BLOCK="${BUDDY_JUDGE_BLOCK:-false}"\n'
    )
    monkeypatch.setenv("BUDDY_JUDGE_ENABLED", "true")  # caller value must win
    monkeypatch.delenv("BUDDY_JUDGE_MODEL", raising=False)
    monkeypatch.delenv("BUDDY_JUDGE_API_KEY", raising=False)
    monkeypatch.delenv("BUDDY_JUDGE_BLOCK", raising=False)

    load_judge_env(tmp_path)

    assert os.environ["BUDDY_JUDGE_ENABLED"] == "true"   # override=False → caller wins
    assert os.environ["BUDDY_JUDGE_MODEL"] == "qwen"     # taken from the file
    assert os.environ["BUDDY_JUDGE_API_KEY"] == ""       # empty value handled
    assert os.environ["BUDDY_JUDGE_BLOCK"] == "false"    # ${VAR:-default} resolved


def test_load_judge_env_override_true_clobbers(tmp_path, monkeypatch):
    from scripts.hook_helpers import load_judge_env
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    (hooks / "judge.env").write_text("export BUDDY_JUDGE_MODEL=fromfile\n")
    monkeypatch.setenv("BUDDY_JUDGE_MODEL", "caller")
    load_judge_env(tmp_path, override=True)
    assert os.environ["BUDDY_JUDGE_MODEL"] == "fromfile"


# --- summon_bootstrap.discover: pure-Python scope precedence (no bash) ---------

def test_discover_precedence_project_over_global_over_builtin(tmp_path, monkeypatch):
    import scripts.summon_bootstrap as sb

    builtin = tmp_path / "builtin"
    (builtin / "skills" / "alpha").mkdir(parents=True)
    (builtin / "skills" / "alpha" / "SKILL.md").write_text("builtin-alpha")
    monkeypatch.setattr(sb, "PLUGIN_ROOT", builtin)

    gh = tmp_path / "gh"
    (gh / "skills" / "alpha").mkdir(parents=True)
    (gh / "skills" / "alpha" / "SKILL.md").write_text("global-alpha")  # overrides builtin
    (gh / "skills" / "beta").mkdir(parents=True)
    (gh / "skills" / "beta" / "SKILL.md").write_text("global-beta")
    monkeypatch.setenv("BUDDY_HOME", str(gh))

    proj = tmp_path / "proj"
    (proj / ".buddy" / "skills" / "beta").mkdir(parents=True)
    (proj / ".buddy" / "skills" / "beta" / "SKILL.md").write_text("proj-beta")  # overrides global

    idx = sb.discover(proj)
    assert set(idx) == {"alpha", "beta"}
    assert idx["alpha"][0] == "global"   # global beat builtin
    assert idx["beta"][0] == "project"   # project beat global
