"""Compact view of one run dir for the end-to-end table (reads analyze.py's summary, drops the bulk).

Usage: python3 -I digest.py <run-dir>
Prints JSON: what each hook process received and printed (wrap_shipped.py / standin.py / hook.py records), what the
CLI's own hook_response events say, the tool_result blocks the transcript recorded for the model, the CLI's
hook attachments, the system-role messages sent to the API that carry hook context or a hook error, and the model's
final reply (first 500 characters).
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
o = json.loads(subprocess.run([sys.executable, "-I", os.path.join(HERE, "analyze.py"), sys.argv[1]],
                              check=True, capture_output=True, text=True).stdout)


def blocks(c):
    if not isinstance(c, list):
        return {"non_list": str(c)[:120]}
    return [{"type": b.get("type"), "has_advice": "advice" in str(b.get("text", "")),
             "has_hint": "HINT_KEEP_4K" in str(b.get("text", "")),
             "text": (b.get("text") or "")[:400] if b.get("type") == "text" else None} for b in c]


ctx = []
for bl in o["api_request_blobs_with_markers"]:
    msg = (bl.get("content") or {}).get("message") or {}
    c = msg.get("content")
    t = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""
    if "hook additional context" in t or "hook blocking error" in t:
        ctx.append({"role": msg.get("role"), "text": t[:330]})
res = o.get("result") or {}
print(json.dumps({
    "run": o["run"], "binary": (o.get("binary") or "")[:40], "exit": (o.get("exit") or "").replace("\n", " "),
    "cost_usd": res.get("total_cost_usd"),
    "hooks_ran": [{"mode": h.get("mode"), "exit": h.get("hook_exit"), "stdout_len": len(h.get("hook_stdout") or ""),
                   "stderr": (h.get("hook_stderr") or "")[:200], "env_sid_eq_stdin": h.get("env_equals_stdin_session_id"),
                   "stdin_sid": h.get("stdin_session_id"), "env_sid": h.get("env_session_id"),
                   "tool": h.get("tool_name"), "n_stdin_keys": len(h.get("stdin_keys") or [])}
                  for h in o["hook_calls"] if "mode" in h],
    "cli_hook_responses": [{"hook": e.get("hook_name"), "outcome": e.get("outcome"), "exit_code": e.get("exit_code"),
                            "stdout_head": (e.get("stdout") or "")[:50], "stderr_head": (e.get("stderr") or "")[:160]}
                           for e in o["hook_events"] if e.get("subtype") == "hook_response"],
    "tool_results": [{"for": t["tool_result_for"][-6:], "blocks": blocks(t["content"])}
                     for t in o["transcript_tool_calls"] if "tool_result_for" in t],
    "cli_attachments": [{"type": a.get("type"),
                         "content": a.get("content") if a.get("type") == "hook_additional_context" else None,
                         "stderr": (a.get("stderr") or "")[:120]} for a in o["transcript_hook_attachments"]],
    "model_context_messages": ctx,
    "final_text": (o.get("final_text") or "")[:500]}, indent=1))
