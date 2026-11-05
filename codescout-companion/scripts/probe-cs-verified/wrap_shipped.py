"""Logging wrapper around the SHIPPED cs-verified hook (and only a wrapper: it must not change behaviour).

Usage (a settings.json hook command):
  python3 -I wrap_shipped.py <log-file> <hook-script.mjs> [tag]

It reads the hook's stdin bytes, runs `node <hook-script.mjs>` with the same environment and exactly those
stdin bytes, and passes the child's stdout bytes, stderr bytes and exit code through unchanged. It appends ONE
JSON line to <log-file> with what the child received and produced: the same fields hook.py logs (stdin_raw,
stdin_keys, env with secret-looking values redacted to their length, start, pid, ppid) plus `hook_stdout`,
`hook_stderr`, `hook_exit` and `hook_script`. `mode` is the tag (default "shipped"), so analyze.py reads it like
a hook.py record. The child is not given a timeout here: the CLI's own hook timeout applies to this wrapper.
"""
import json, os, re, subprocess, sys, time

LOG, SCRIPT = sys.argv[1], sys.argv[2]
TAG = sys.argv[3] if len(sys.argv) > 3 else "shipped"
SECRET = re.compile(r"TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE", re.I)

t0 = time.time()
raw = sys.stdin.buffer.read()
text = raw.decode("utf-8", "replace")
try:
    data = json.loads(text)
except ValueError:
    data = None
env = {k: (f"<redacted len={len(v)}>" if SECRET.search(k) else v) for k, v in sorted(os.environ.items())}
p = subprocess.run(["node", SCRIPT], input=raw, capture_output=True)
with open(LOG, "a") as f:
    f.write(json.dumps({
        "mode": TAG, "start": t0, "end": time.time(), "pid": os.getpid(), "ppid": os.getppid(),
        "stdin_keys": sorted(data) if isinstance(data, dict) else None,
        "env": env, "stdin_raw": text, "hook_script": SCRIPT,
        "hook_stdout": p.stdout.decode("utf-8", "replace"),
        "hook_stderr": p.stderr.decode("utf-8", "replace"), "hook_exit": p.returncode}) + "\n")
sys.stdout.buffer.write(p.stdout)
sys.stdout.buffer.flush()
sys.stderr.buffer.write(p.stderr)
sys.stderr.buffer.flush()
sys.exit(p.returncode)
