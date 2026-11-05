"""Summarise one cs-verified probe run dir as JSON (what the hook got, what it printed, what the model saw).

Usage: python3 -I analyze.py <run-dir>

Sources: hook-log.jsonl (written by hook.py), stream.jsonl (--include-hook-events),
transcript.jsonl (the session transcript copied by run.sh), exit.txt, binary.txt.
"""
import json, os, re, sys

run = sys.argv[1]
MARKERS = ("[cs-verified]", "probe_fn_9v", "HINT_KEEP_4K", "SECOND_BLOCK_7Q",
           "PROBE_EXIT2_STDERR_5M", "MALFORMED_6P")


def rows(name):
    p = os.path.join(run, name)
    if not os.path.exists(p):
        return []
    out = []
    for line in open(p, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except ValueError:
                out.append({"_unparsed": line[:200]})
    return out


def shape(tr):
    if isinstance(tr, list):
        return {"type": "list", "block_types": [b.get("type") if isinstance(b, dict) else type(b).__name__ for b in tr]}
    return {"type": type(tr).__name__}


out = {"run": os.path.basename(run.rstrip("/"))}
for f in ("binary.txt", "exit.txt"):
    p = os.path.join(run, f)
    out[f.split(".")[0]] = open(p).read().strip() if os.path.exists(p) else None

hooks = []
for r in rows("hook-log.jsonl"):
    if "stdin_raw" not in r:
        hooks.append({"event": r.get("event"), "t": r.get("t")}); continue
    try:
        d = json.loads(r["stdin_raw"])
    except ValueError:
        d = {}
    hooks.append({"mode": r["mode"], "start": r["start"], "stdin_keys": r["stdin_keys"],
                  "agent_id": d.get("agent_id"), "agent_type": d.get("agent_type"),
                  "tool_name": d.get("tool_name"), "tool_response_shape": shape(d.get("tool_response")),
                  "env_signal": {k: v for k, v in r["env"].items()
                                 if k.startswith("CLAUDE") or k.startswith("AI_") or k.startswith("ANTHROPIC")}})
out["hook_calls"] = hooks

stream = rows("stream.jsonl")
out["hook_events"] = [{k: (v[:300] + f"...<{len(v)} chars>" if isinstance(v, str) and len(v) > 300 else v)
                       for k, v in e.items() if k in ("subtype", "hook_name", "outcome", "exit_code", "stdout", "stderr", "output")}
                      for e in stream if e.get("type") == "system" and str(e.get("subtype", "")).startswith("hook")]
res = [e for e in stream if e.get("type") == "result"]
if res:
    out["result"] = {k: res[-1].get(k) for k in ("subtype", "is_error", "total_cost_usd", "num_turns", "result")}

tr = rows("transcript.jsonl")
tool_ids = set()
results, attachments, blobs = [], [], []
for e in tr:
    msg = e.get("message") or {}
    content = msg.get("content")
    if e.get("type") == "assistant" and isinstance(content, list):
        for c in content:
            if c.get("type") == "tool_use":
                tool_ids.add(c.get("id"))
                results.append({"tool_use": c.get("name"), "id": c.get("id"), "sidechain": e.get("isSidechain")})
    if e.get("type") == "user" and isinstance(content, list):
        for c in content:
            if c.get("type") == "tool_result":
                results.append({"tool_result_for": c.get("tool_use_id"), "is_error": c.get("is_error"),
                                "sidechain": e.get("isSidechain"), "content": c.get("content")})
    if e.get("type") == "attachment":
        a = e.get("attachment") or {}
        if str(a.get("type", "")).startswith("hook") or any(m in json.dumps(a) for m in MARKERS):
            attachments.append(a)
    if e.get("type") == "api-request-blob":
        s = json.dumps(e)
        hits = [m for m in MARKERS if m in s]
        if hits:
            blobs.append({"markers": hits, "content": e.get("content") if "content" in e else e})
out["transcript_tool_calls"] = results
out["transcript_hook_attachments"] = attachments
out["api_request_blobs_with_markers"] = blobs
finals = [c.get("text") for e in tr if e.get("type") == "assistant"
          for c in ((e.get("message") or {}).get("content") or []) if c.get("type") == "text"]
out["final_text"] = finals[-1] if finals else None
print(json.dumps(out, indent=1))
