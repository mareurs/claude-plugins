#!/usr/bin/env python3
"""Fake `opencode` CLI. State lives in $FAKE_OC_DIR:
  script.json  {"METHOD path": {"out": "<stdout>", "exit": 0, "after_start": {"out": ..., "exit": ...}}}
  argv.log     one JSON array per invocation (full argv after the program name)
  starts       one line per `service start`
An entry's "after_start" override applies once `service start` ran.
The `id` of the last `POST .../prompt` body is kept in `prompt_id` and replaces every
`{{PROMPT_ID}}` in later outputs, like a service that stored the client message id."""
import json, os, pathlib, sys

# Invoked through a per-test symlink: state is the `state/` dir beside that symlink (argv[0] is
# the unresolved path). $FAKE_OC_DIR overrides it.
d = pathlib.Path(os.environ.get("FAKE_OC_DIR") or pathlib.Path(sys.argv[0]).parent / "state")
args = sys.argv[1:]
with open(d / "argv.log", "a") as f:
    f.write(json.dumps(args) + "\n")

if args[:2] == ["service", "start"]:
    with open(d / "starts", "a") as f:
        f.write("start\n")
    sys.exit(int(os.environ.get("FAKE_OC_START_EXIT", "0")))

if args[:1] == ["api"] and len(args) >= 3:
    script = json.loads((d / "script.json").read_text())
    entry = script.get(f"{args[1]} {args[2]}", {"out": "HTTP 404 Not Found", "exit": 1})
    if (d / "starts").exists() and "after_start" in entry:
        after = entry["after_start"]
        # "healthy_after": N -> the first N-1 probes after start still use the pre-start answer
        n = after.get("healthy_after", 1)
        counter = d / "post_probes"
        seen = int(counter.read_text()) + 1 if counter.exists() else 1
        counter.write_text(str(seen))
        if seen >= n:
            entry = after
    if args[1] == "POST" and args[2].endswith("/prompt") and args[3:4] == ["-d"]:
        (d / "prompt_id").write_text(json.loads(args[4]).get("id", ""))
    out = entry.get("out", "")
    if (d / "prompt_id").exists():
        out = out.replace("{{PROMPT_ID}}", (d / "prompt_id").read_text())
    sys.stdout.write(out)
    sys.exit(entry.get("exit", 0))

sys.stderr.write("unsupported argv\n")
sys.exit(2)
