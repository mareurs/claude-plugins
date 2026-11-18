"""PostToolUse PROBE hook for the cs-verified measurements (not the production hook).

Usage (from a settings.json hook command):  python3 -I hook.py <mode> <log-file>

Every mode first appends one JSON line to <log-file>: the raw stdin bytes (as text), the
parsed stdin keys, the environment the CLI gave this process (values of secret-looking names
redacted to their length), the mode, and wall-clock start time. Then:

  empty      print nothing, exit 0
  braces     print {} , exit 0
  relocate   print updatedToolOutput (every block kept, only the block whose JSON has a
             top-level advice with verified true edited: advice removed) plus
             additionalContext "[cs-verified] <advice text>", exit 0
  sleep      sleep 5 s, then do what relocate does (run it with a hook timeout of 2 s)
  exit2      print a marker line on stderr, nothing on stdout, exit 2
  malformed  print a truncated JSON object on stdout, exit 0
  big        print the relocate JSON with 2 MiB of spaces between its two top-level
             members (valid JSON, 2 MiB+ on stdout), exit 0
"""
import json, os, re, sys, time

MODE = sys.argv[1] if len(sys.argv) > 1 else "empty"
LOG = sys.argv[2] if len(sys.argv) > 2 else None
SECRET = re.compile(r"TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE", re.I)

t0 = time.time()
raw = sys.stdin.buffer.read().decode("utf-8", "replace")
try:
    data = json.loads(raw)
except ValueError:
    data = None

if LOG:
    env = {k: (f"<redacted len={len(v)}>" if SECRET.search(k) else v) for k, v in sorted(os.environ.items())}
    with open(LOG, "a") as f:
        f.write(json.dumps({"mode": MODE, "start": t0, "pid": os.getpid(), "ppid": os.getppid(),
                            "stdin_keys": sorted(data) if isinstance(data, dict) else None,
                            "env": env, "stdin_raw": raw}) + "\n")


def relocation():
    tr = data.get("tool_response") if isinstance(data, dict) else None
    if not isinstance(tr, list):
        return None
    out, text = [], None
    for b in tr:
        if text is None and isinstance(b, dict) and b.get("type") == "text":
            try:
                env = json.loads(b.get("text", ""))
            except ValueError:
                env = None
            if isinstance(env, dict) and isinstance(env.get("advice"), dict) \
                    and env["advice"].get("verified") is True:
                text = env["advice"]["text"]
                del env["advice"]
                out.append(dict(b, text=json.dumps(env)))
                continue
        out.append(b)
    if text is None:
        return None
    return {"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                   "updatedToolOutput": out,
                                   "additionalContext": "[cs-verified] " + text}}


if MODE == "empty":
    sys.exit(0)
if MODE == "braces":
    print("{}"); sys.exit(0)
if MODE == "exit2":
    sys.stderr.write("PROBE_EXIT2_STDERR_5M: text the probe hook wrote to stderr before exit 2\n")
    sys.exit(2)
if MODE == "malformed":
    sys.stdout.write('{"hookSpecificOutput": {"hookEventName": "PostToolUse", '
                     '"additionalContext": "[cs-verified] MALFORMED_6P')
    sys.exit(0)
if MODE == "sleep":
    time.sleep(5)
    if LOG:
        with open(LOG, "a") as f:
            f.write(json.dumps({"mode": MODE, "event": "woke after sleep", "t": time.time()}) + "\n")
out = relocation()
if out is None:
    sys.exit(0)
if MODE == "big":
    body = json.dumps(out["hookSpecificOutput"])
    sys.stdout.write('{"hookSpecificOutput": ' + body + ',' + ' ' * (2 * 1024 * 1024) + '"suppressOutput": false}\n')
else:
    print(json.dumps(out))
sys.stdout.flush()
if MODE == "sleep" and LOG:
    with open(LOG, "a") as f:
        f.write(json.dumps({"mode": MODE, "event": "printed after sleep", "t": time.time()}) + "\n")
sys.exit(0)
