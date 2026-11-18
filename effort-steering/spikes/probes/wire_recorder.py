#!/usr/bin/env python3
"""Wire recorder for ES-17 instrument check I1. Throwaway, scratchpad only.

Listens on 127.0.0.1 only and forwards every POST to the upstream (default https://api.anthropic.com),
streaming the response back unchanged. It logs ONE json line per request with the fields that answer
"what effort did the client really send": top-level keys, `output_config`, `thinking`, the beta header,
model, stream, max_tokens, message count, the roles of the last messages, and any message that carries an
`output_config` key or has role `system` (the per-message effort pins). It never logs headers other than the
Claude Code session id and the beta header, and never logs message text.

    WIRE_PORT=8099 WIRE_UPSTREAM=https://api.anthropic.com WIRE_LOG=/path/wire.jsonl python3 wire_recorder.py
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

UPSTREAM = os.environ.get("WIRE_UPSTREAM", "https://api.anthropic.com")
LOGPATH = os.environ.get("WIRE_LOG", "/tmp/wire.jsonl")
PORT = int(os.environ.get("WIRE_PORT", "8099"))
DROP_REQ = {"host", "content-length", "connection", "transfer-encoding", "accept-encoding"}
DROP_RESP = {"content-length", "transfer-encoding", "connection", "content-encoding"}


def pins_of(messages):
    out = []
    for i, m in enumerate(messages or []):
        if not isinstance(m, dict):
            continue
        if m.get("role") == "system" or "output_config" in m:
            content = m.get("content")
            out.append({
                "i": i,
                "role": m.get("role"),
                "output_config": m.get("output_config"),
                "content_len": len(content) if isinstance(content, (list, str)) else None,
                "keys": sorted(m.keys()),
            })
    return out


def record(path, headers, body):
    rec = {
        "ts": time.time(),
        "path": path,
        "session_id": headers.get("x-claude-code-session-id"),
        "anthropic_beta": headers.get("anthropic-beta"),
        "parse_error": None,
    }
    try:
        req = json.loads(body)
    except Exception as exc:  # noqa: BLE001
        rec["parse_error"] = repr(exc)
    else:
        msgs = req.get("messages") or []
        rec["top_keys"] = sorted(req.keys())
        rec["model"] = req.get("model")
        rec["stream"] = req.get("stream", "<ABSENT>")
        rec["thinking"] = req.get("thinking", "<ABSENT>")
        rec["output_config"] = req.get("output_config", "<ABSENT>")
        rec["max_tokens"] = req.get("max_tokens")
        rec["n_messages"] = len(msgs)
        rec["last_roles"] = [m.get("role") for m in msgs[-4:] if isinstance(m, dict)]
        rec["pins"] = pins_of(msgs)
    with open(LOGPATH, "a") as fh:
        fh.write(json.dumps(rec) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        try:
            record(self.path, self.headers, body)
        except Exception as exc:  # noqa: BLE001
            print(f"record failed: {exc!r}", file=sys.stderr, flush=True)
        hdrs = {k: v for k, v in self.headers.items() if k.lower() not in DROP_REQ}
        hdrs["Accept-Encoding"] = "identity"
        resp = requests.post(UPSTREAM + self.path, headers=hdrs, data=body, stream=True, timeout=900)
        self.send_response(resp.status_code)
        for k, v in resp.headers.items():
            if k.lower() not in DROP_RESP:
                self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        for chunk in resp.iter_content(chunk_size=None):
            if chunk:
                self.wfile.write(b"%x\r\n" % len(chunk) + chunk + b"\r\n")
                self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    print(f"wire recorder 127.0.0.1:{PORT} -> {UPSTREAM}, log {LOGPATH}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
