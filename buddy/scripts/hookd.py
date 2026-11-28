#!/usr/bin/env python3
"""Loopback HTTP daemon for the two buddy hooks that run on every tool call.

    python scripts/hookd.py            run the daemon (foreground)
    python scripts/hookd.py --ensure   start one detached if nothing answers /health

Claude Code POSTs the PreToolUse / PostToolUse event JSON to /pre-tool-use or
/post-tool-use (a `type: "http"` hook). One long-lived process replaces the
node + python process pair the command hook starts per call, which costs about
1 s under endpoint protection. The handlers are the same scripts.hook_entry
functions, run in-process; session-start, user-prompt-submit and session-end
stay command hooks because they run once per session or prompt.

Each request is isolated the way a fresh process would be: the environment is
restored to the daemon's starting environment and judge.env is applied with the
event's own precedence, requests run one at a time, and stdout / stderr are
captured per request. A blocking verdict (exit 2) becomes a PreToolUse deny
body, because HTTP hooks have no exit codes. Fail-open: any error answers 200
with an empty body. Bearer token from $CLAUDE_PLUGINS_HOOKD_TOKEN, 127.0.0.1
only, exit after BUDDY_HOOKD_IDLE_S (default 30 min) without a request.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

HOST = "127.0.0.1"
PORT = int(os.environ.get("BUDDY_HOOKD_PORT", "47616"))
# 12 h: session-start and every user-prompt-submit make sure the daemon runs (hook_dispatch.py),
# so a pause only costs the first prompt after it, and a working day never loses it.
IDLE_S = float(os.environ.get("BUDDY_HOOKD_IDLE_S", str(12 * 60 * 60)))
MAX_BODY = 8 * 1024 * 1024

# URL path -> (hook_dispatch event name, Claude Code event name)
ROUTES = {
    "/pre-tool-use": ("pre-tool-use", "PreToolUse"),
    "/post-tool-use": ("post-tool-use", "PostToolUse"),
}
# judge.env precedence per event, as hooks/hook_dispatch.py applies it:
# post-tool-use: the file wins; pre-tool-use: a caller-set variable wins.
JUDGE_ENV_OVERRIDE = {"pre-tool-use": False, "post-tool-use": True}

_LOCK = threading.Lock()
_BASE_ENV = dict(os.environ)
VERSION = ""  # set by serve(): the version of the code this process loaded


def _deny(reason: str) -> str:
    return json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason or "blocked by a buddy hook",
        },
    })


def _merge_stdout(text: str, claude_event: str) -> str:
    """Turn what a hook printed into one JSON object, or '' when it printed none.

    A hook may print several JSON objects (one per line); additionalContext texts
    are joined. Plain text has no home in an HTTP answer and is dropped.
    """
    contexts: list[str] = []
    other: dict = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        for key, value in obj.items():
            if key == "hookSpecificOutput" and isinstance(value, dict):
                ctx = value.get("additionalContext")
                if isinstance(ctx, str):
                    contexts.append(ctx)
                for k, v in value.items():
                    if k not in ("additionalContext", "hookEventName"):
                        other.setdefault("hookSpecificOutput", {}).setdefault(k, v)
            else:
                other.setdefault(key, value)
    if not contexts and not other:
        return ""
    out = dict(other)
    specific = dict(out.get("hookSpecificOutput", {}))
    specific["hookEventName"] = claude_event
    if contexts:
        specific["additionalContext"] = "\n".join(contexts)
    out["hookSpecificOutput"] = specific
    return json.dumps(out)


def handle(route: str, raw: bytes, plugin_root: Path = PLUGIN_ROOT, base_env: dict | None = None) -> tuple[int, str]:
    """Run one hook event. Returns (HTTP status, body). Never raises."""
    if route not in ROUTES:
        return 404, ""
    event_name, claude_event = ROUTES[route]
    base_env = _BASE_ENV if base_env is None else base_env
    try:
        event = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(event, dict):
            event = {}
    except Exception:
        event = {}
    out, err = io.StringIO(), io.StringIO()
    rc = 0
    with _LOCK:
        saved = dict(os.environ)
        try:
            os.environ.clear()
            os.environ.update(base_env)
            try:
                from scripts.hook_helpers import load_judge_env
                load_judge_env(plugin_root, override=JUDGE_ENV_OVERRIDE[event_name])
            except Exception:
                pass
            from scripts.hook_entry import DISPATCH
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = DISPATCH[event_name](event, plugin_root, 0) or 0
        except Exception:
            return 200, ""
        finally:
            os.environ.clear()
            os.environ.update(saved)
    if rc == 2 and claude_event == "PreToolUse":
        return 200, _deny(err.getvalue().strip())
    return 200, _merge_stdout(out.getvalue(), claude_event)


def code_version() -> str:
    """Identifies the code a daemon loaded once (every scripts/*.py); a daemon that started
    before a plugin update answers a different version than a new session expects."""
    h = hashlib.sha1()
    for path in sorted((PLUGIN_ROOT / "scripts").glob("*.py")):
        h.update(path.name.encode())
        h.update(path.read_bytes())
    return h.hexdigest()[:12]


def _call(method: str, path: str):
    headers = {}
    token = os.environ.get("CLAUDE_PLUGINS_HOOKD_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"http://{HOST}:{PORT}{path}", method=method, headers=headers, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=0.4) as r:
        return r.status, r.read().decode("utf-8")


def _running_version():
    """The version a running daemon reports, or None when nothing answers."""
    try:
        status, body = _call("GET", "/health")
        return json.loads(body).get("version", "") if status == 200 else None
    except Exception:
        return None


def ensure() -> None:
    """Make sure a daemon of this code version answers; start one detached if not. Fail-open."""
    try:
        want = code_version()
        have = _running_version()
        if have == want:
            return
        if have is not None:  # a daemon of another version: ask it to quit, then wait for the port
            try:
                _call("POST", "/quit")
            except Exception:
                pass
            for _ in range(40):
                if _running_version() is None:
                    break
                time.sleep(0.05)
        kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([sys.executable, str(Path(__file__).resolve())], **kwargs)
        for _ in range(60):
            if _running_version() == want:
                return
            time.sleep(0.05)
    except Exception:
        pass


class _Handler(BaseHTTPRequestHandler):
    server_version = "buddy-hookd"

    def log_message(self, *args):  # silence per-request logging
        pass

    def _send(self, status: int, body: str = "") -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.server.last_request = time.time()  # type: ignore[attr-defined]
        if self.path == "/health":
            return self._send(200, json.dumps({"ok": True, "version": VERSION}))
        self._send(404)

    def do_POST(self):
        self.server.last_request = time.time()  # type: ignore[attr-defined]
        token = os.environ.get("CLAUDE_PLUGINS_HOOKD_TOKEN", "")
        if token and self.headers.get("Authorization") != f"Bearer {token}":
            return self._send(401)
        if self.path == "/quit":
            self._send(200)
            threading.Thread(target=lambda: (time.sleep(0.05), os._exit(0)), daemon=True).start()
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._send(413)
        status, body = handle(self.path, self.rfile.read(length))
        self._send(status, body)


def serve() -> None:
    global VERSION
    VERSION = code_version()
    try:
        server = ThreadingHTTPServer((HOST, PORT), _Handler)
    except OSError:
        return  # another daemon already serves this port
    server.daemon_threads = True
    server.last_request = time.time()  # type: ignore[attr-defined]

    def idle_watch():
        while True:
            time.sleep(30)
            if time.time() - server.last_request > IDLE_S:  # type: ignore[attr-defined]
                os._exit(0)

    threading.Thread(target=idle_watch, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    ensure() if "--ensure" in sys.argv[1:] else serve()
