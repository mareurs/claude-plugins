"""Stub stdio MCP server for the cs-verified probe. Register it as server `codescout`.

Tool `edit_code` returns the envelope codescout's `edit_code replace` emits
(`status`, `replaced_lines`, `hint`, `advice {text, verified}`; field names from
codescout `src/tools/symbol/edit_code.rs` do_replace and `callers_check.rs` advice_for).

argv[1] picks the content blocks of the result:
  one    [envelope]
  two    [envelope, second text block]
  mixed  [envelope, second text block, a 1x1 PNG image block]

Adapted from codescout docs/evals/data/2026-11-04-harness-channel-hints/relocation-probe/stub_mcp.py.
"""
import json, sys

MODE = sys.argv[1] if len(sys.argv) > 1 else "two"

ADVICE_TEXT = ('verify callers: references(symbol="probe_fn_9v", path="src/lib.rs") | '
               '`probe_fn_9v` is called by name in src/other.rs '
               '(a syntactic match, not resolved by the language server)')
ENVELOPE = json.dumps({
    "status": "ok",
    "replaced_lines": "10-12",
    "hint": "HINT_KEEP_4K: a protocol hint that must stay in the result",
    "advice": {"text": ADVICE_TEXT, "verified": True},
})
SECOND = {"type": "text", "text": "SECOND_BLOCK_7Q: a second text block from the stub"}
# 1x1 transparent PNG
PNG_1X1 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA"
           "60e6kgAAAABJRU5ErkJggg==")


def content():
    blocks = [{"type": "text", "text": ENVELOPE}]
    if MODE in ("two", "mixed"):
        blocks.append(SECOND)
    if MODE == "mixed":
        blocks.append({"type": "image", "data": PNG_1X1, "mimeType": "image/png"})
    return blocks


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n"); sys.stdout.flush()


for line in sys.stdin:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    mid, method = msg.get("id"), msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "codescout-stub", "version": "0.0.1"}}})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [{
            "name": "edit_code", "description": "Returns a fixed edit_code replace result.",
            "inputSchema": {"type": "object", "properties": {}}}]}})
    elif method == "tools/call":
        send({"jsonrpc": "2.0", "id": mid, "result": {"content": content()}})
    elif mid is not None:
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
