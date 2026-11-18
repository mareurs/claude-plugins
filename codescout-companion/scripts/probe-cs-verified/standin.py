"""Stand-in for the buddy plugin's unmatched PostToolUse hook (coexistence measurement).

Usage (a settings.json hook command, registered WITHOUT a matcher):
  python3 -I standin.py <log-file> [delay-seconds]

Logs one JSON line (stdin_raw, stdin_keys, start, end) to <log-file>, optionally sleeps, then prints
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[cs-hint] stand-in"}} and exits 0.
"""
import json, os, sys, time

LOG = sys.argv[1]
DELAY = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
t0 = time.time()
raw = sys.stdin.buffer.read().decode("utf-8", "replace")
try:
    data = json.loads(raw)
except ValueError:
    data = None
if DELAY:
    time.sleep(DELAY)
out = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "[cs-hint] stand-in"}}
with open(LOG, "a") as f:
    f.write(json.dumps({"mode": "standin", "start": t0, "end": time.time(), "pid": os.getpid(), "env": {},
                        "stdin_keys": sorted(data) if isinstance(data, dict) else None,
                        "tool_name": data.get("tool_name") if isinstance(data, dict) else None,
                        "stdin_raw": raw, "hook_stdout": json.dumps(out), "hook_exit": 0}) + "\n")
print(json.dumps(out))
sys.exit(0)
