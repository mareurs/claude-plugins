"""Run codescout's MCP tools against a throwaway sandbox.

WHY THIS EXISTS: skills prescribe tool calls, and nothing ran them (bug af3292c4ea2d4712).
A real server is the only judge of whether a call is legal — some rules live in server state
(a ledger must declare `entry_prefix`) or in value grammar (`dated` takes an ISO date), and
appear in no tool schema.

ISOLATION. The child gets a minimal environment: PATH, plus a HOME and a CODESCOUT_SQLITE_DIR
under the sandbox. It inherits no CODESCOUT_*/LIBRARIAN_* variable, so it cannot reach the
shared Qdrant or the live catalog. CODESCOUT_ALLOW_TEMP_WORKSPACE=1 is required because the
server refuses to catalogue artifacts rooted under the system temp dir otherwise.

A REJECTION IS NOT AN MCP ERROR. The server answers a refused call with isError=false and a
text body whose JSON says {"ok": false, "error": ...}. `Reply.ok` reads both, so a caller that
asks "did it work" cannot mistake a refusal for success. The text also carries guide prose
after the JSON, so the payload is decoded with raw_decode.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path


def find_binary() -> str | None:
    """CODESCOUT_BIN, then PATH, then the cargo install dir. None when absent."""
    explicit = os.environ.get("CODESCOUT_BIN")
    if explicit and os.access(explicit, os.X_OK):
        return explicit
    on_path = shutil.which("codescout")
    if on_path:
        return on_path
    cargo = Path.home() / ".cargo" / "bin" / "codescout"
    return str(cargo) if os.access(cargo, os.X_OK) else None


@dataclass
class Reply:
    ok: bool
    payload: dict = field(default_factory=dict)
    text: str = ""

    @property
    def error(self) -> str:
        return str(self.payload.get("error", "")) if not self.ok else ""


def _decode(text: str) -> dict:
    stripped = text.lstrip()
    if not stripped.startswith("{"):
        return {}
    try:
        value, _ = json.JSONDecoder().raw_decode(stripped)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


class IsolatedCodescout:
    """Context manager: one stdio MCP server rooted at `repo`, state under `sandbox`."""

    def __init__(self, repo: Path, sandbox: Path, binary: str, timeout: float = 60.0):
        self.repo, self.sandbox, self.binary, self.timeout = repo, sandbox, binary, timeout
        self._id = 0
        self._out: "queue.Queue[str]" = queue.Queue()
        self.stderr: list[str] = []
        self._proc: subprocess.Popen | None = None

    def __enter__(self) -> "IsolatedCodescout":
        home, sqlite = self.sandbox / "home", self.sandbox / "sqlite"
        home.mkdir(parents=True, exist_ok=True)
        sqlite.mkdir(parents=True, exist_ok=True)
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(home),
            "CODESCOUT_SQLITE_DIR": str(sqlite),
            "CODESCOUT_ALLOW_TEMP_WORKSPACE": "1",
        }
        self._proc = subprocess.Popen(
            [self.binary, "start", "-p", str(self.repo)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=env, text=True, bufsize=1,
        )
        threading.Thread(target=lambda: [self._out.put(l) for l in self._proc.stdout], daemon=True).start()
        threading.Thread(target=lambda: [self.stderr.append(l) for l in self._proc.stderr], daemon=True).start()
        self._rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                 "clientInfo": {"name": "skill-call-legality", "version": "1"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    def __exit__(self, *_exc) -> None:
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def _send(self, msg: dict) -> None:
        assert self._proc and self._proc.stdin
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()

    def _rpc(self, method: str, params: dict) -> dict:
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        while True:
            try:
                line = self._out.get(timeout=self.timeout)
            except queue.Empty:
                raise RuntimeError(f"codescout gave no reply to {method} in {self.timeout}s") from None
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == self._id:
                return msg

    def call(self, tool: str, **args) -> Reply:
        msg = self._rpc("tools/call", {"name": tool, "arguments": args})
        if "error" in msg:
            return Reply(ok=False, payload={"error": msg["error"]}, text=json.dumps(msg["error"]))
        result = msg["result"]
        text = "".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
        payload = _decode(text)
        return Reply(ok=not result.get("isError", False) and payload.get("ok") is not False,
                     payload=payload, text=text)
