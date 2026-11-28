"""Tests for scripts/hookd.py, the loopback HTTP daemon behind buddy's per-tool-call hooks."""
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from scripts import hook_entry, hookd  # noqa: E402


def _hook(monkeypatch, name, fn):
    monkeypatch.setitem(hook_entry.DISPATCH, name, fn)


def _ctx(text):
    return json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}})


def test_unknown_route_is_404():
    assert hookd.handle("/nope", b"{}") == (404, "")


def test_post_tool_use_context_is_returned_as_one_json_body(monkeypatch):
    def fake(event, plugin_root, ppid):
        print(_ctx("first"))
        print(_ctx("second"))
        return 0
    _hook(monkeypatch, "post-tool-use", fake)
    status, body = hookd.handle("/post-tool-use", b'{"tool_name":"Bash"}')
    assert status == 200
    out = json.loads(body)
    assert out["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
    assert out["hookSpecificOutput"]["additionalContext"] == "first\nsecond"


def test_a_hook_that_prints_nothing_answers_an_empty_body(monkeypatch):
    _hook(monkeypatch, "post-tool-use", lambda e, r, p: 0)
    assert hookd.handle("/post-tool-use", b"{}") == (200, "")


def test_plain_text_output_has_no_home_in_an_http_answer(monkeypatch):
    def fake(event, plugin_root, ppid):
        print("not json at all")
        return 0
    _hook(monkeypatch, "post-tool-use", fake)
    assert hookd.handle("/post-tool-use", b"{}") == (200, "")


def test_exit_2_becomes_a_pre_tool_use_deny_with_the_stderr_reason(monkeypatch):
    def fake(event, plugin_root, ppid):
        print("correct this first", file=sys.stderr)
        return 2
    _hook(monkeypatch, "pre-tool-use", fake)
    status, body = hookd.handle("/pre-tool-use", b"{}")
    assert status == 200
    specific = json.loads(body)["hookSpecificOutput"]
    assert specific["hookEventName"] == "PreToolUse"
    assert specific["permissionDecision"] == "deny"
    assert specific["permissionDecisionReason"] == "correct this first"


def test_the_event_json_reaches_the_hook(monkeypatch):
    seen = {}

    def fake(event, plugin_root, ppid):
        seen.update(event=event, root=plugin_root)
        return 0
    _hook(monkeypatch, "pre-tool-use", fake)
    hookd.handle("/pre-tool-use", json.dumps({"tool_name": "Read", "session_id": "s1"}).encode())
    assert seen["event"] == {"tool_name": "Read", "session_id": "s1"}


def test_a_crashing_hook_fails_open(monkeypatch):
    def boom(event, plugin_root, ppid):
        raise RuntimeError("boom")
    _hook(monkeypatch, "post-tool-use", boom)
    assert hookd.handle("/post-tool-use", b"{}") == (200, "")


def test_unparsable_json_is_treated_as_an_empty_event(monkeypatch):
    seen = {}
    _hook(monkeypatch, "pre-tool-use", lambda e, r, p: seen.update(event=e) or 0)
    assert hookd.handle("/pre-tool-use", b"not json")[0] == 200
    assert seen["event"] == {}


def test_a_request_cannot_leak_environment_into_the_next(monkeypatch):
    def leaky(event, plugin_root, ppid):
        os.environ["BUDDY_LEAK"] = "1"
        return 0
    _hook(monkeypatch, "post-tool-use", leaky)
    hookd.handle("/post-tool-use", b"{}", base_env={"PATH": os.environ.get("PATH", "")})
    assert "BUDDY_LEAK" not in os.environ

    seen = {}
    _hook(monkeypatch, "pre-tool-use", lambda e, r, p: seen.update(v=os.environ.get("BUDDY_LEAK")) or 0)
    hookd.handle("/pre-tool-use", b"{}", base_env={"PATH": os.environ.get("PATH", "")})
    assert seen["v"] is None


def test_judge_env_precedence_follows_the_event(monkeypatch, tmp_path):
    (tmp_path / "hooks").mkdir()
    (tmp_path / "hooks" / "judge.env").write_text("BUDDY_X=file\n")
    seen = {}
    _hook(monkeypatch, "pre-tool-use", lambda e, r, p: seen.update(pre=os.environ.get("BUDDY_X")) or 0)
    _hook(monkeypatch, "post-tool-use", lambda e, r, p: seen.update(post=os.environ.get("BUDDY_X")) or 0)
    base = {"BUDDY_X": "caller"}
    hookd.handle("/pre-tool-use", b"{}", plugin_root=tmp_path, base_env=base)
    hookd.handle("/post-tool-use", b"{}", plugin_root=tmp_path, base_env=base)
    assert seen == {"pre": "caller", "post": "file"}  # pre: caller wins; post: the file wins


@pytest.fixture
def server(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), hookd._Handler)
    srv.last_request = 0
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _post(url, body=b"{}", token=None):
    req = urllib.request.Request(url, data=body, method="POST")
    if token is not None:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, ""


def test_http_health_route_and_a_deny_round_trip(monkeypatch, server):
    monkeypatch.delenv("CLAUDE_PLUGINS_HOOKD_TOKEN", raising=False)
    monkeypatch.setitem(hook_entry.DISPATCH, "pre-tool-use", lambda e, r, p: print("no", file=sys.stderr) or 2)
    with urllib.request.urlopen(server + "/health", timeout=5) as r:
        assert r.status == 200
    status, body = _post(server + "/pre-tool-use")
    assert status == 200 and json.loads(body)["hookSpecificOutput"]["permissionDecision"] == "deny"


def _run_dispatch(monkeypatch, event_name):
    """Run hooks/hook_dispatch.py's main() for one event with the daemon ensure recorded."""
    import importlib.util
    import io

    spec = importlib.util.spec_from_file_location("hook_dispatch_under_test", PLUGIN_ROOT / "hooks" / "hook_dispatch.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    calls = []
    monkeypatch.setattr(hookd, "ensure", lambda: calls.append(1))
    monkeypatch.setitem(hook_entry.DISPATCH, event_name, lambda e, r, p: 0)
    monkeypatch.setattr(sys, "argv", ["hook_dispatch.py", event_name])
    monkeypatch.setattr(sys, "stdin", io.StringIO("{}"))
    assert mod.main() == 0
    return calls


# A session can outlive the daemon (idle exit, a crash), and every http hook then fails silently.
@pytest.mark.parametrize("event_name", ["session-start", "user-prompt-submit"])
def test_session_start_and_every_prompt_make_sure_the_daemon_runs(monkeypatch, event_name):
    assert _run_dispatch(monkeypatch, event_name) == [1]


@pytest.mark.parametrize("event_name", ["pre-tool-use", "post-tool-use", "session-end"])
def test_other_events_do_not_start_the_daemon(monkeypatch, event_name):
    assert _run_dispatch(monkeypatch, event_name) == []


def test_code_version_is_a_stable_identifier_of_the_scripts():
    assert len(hookd.code_version()) == 12
    assert hookd.code_version() == hookd.code_version()


def test_http_health_reports_the_version(monkeypatch, server):
    monkeypatch.setattr(hookd, "VERSION", "abc123def456")
    with urllib.request.urlopen(server + "/health", timeout=5) as r:
        assert json.loads(r.read()) == {"ok": True, "version": "abc123def456"}


def test_http_quit_needs_the_token(monkeypatch, server):
    # Only the refusal is exercised: an accepted /quit ends the process.
    monkeypatch.setenv("CLAUDE_PLUGINS_HOOKD_TOKEN", "s3cret")
    assert _post(server + "/quit")[0] == 401
    assert _post(server + "/quit", token="wrong")[0] == 401


def test_http_token_is_required_when_set(monkeypatch, server):
    monkeypatch.setenv("CLAUDE_PLUGINS_HOOKD_TOKEN", "s3cret")
    monkeypatch.setitem(hook_entry.DISPATCH, "post-tool-use", lambda e, r, p: 0)
    assert _post(server + "/post-tool-use")[0] == 401
    assert _post(server + "/post-tool-use", token="wrong")[0] == 401
    assert _post(server + "/post-tool-use", token="s3cret")[0] == 200
