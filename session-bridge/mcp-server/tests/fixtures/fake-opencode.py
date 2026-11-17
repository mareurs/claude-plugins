#!/usr/bin/env python3
"""Fake `opencode` CLI. State lives in $FAKE_OC_DIR:
  script.json  {"METHOD path": {"out": "<stdout>", "exit": 0, "after_start": {"out": ..., "exit": ...}}}
  argv.log     one JSON array per invocation (full argv after the program name)
  starts       one line per `service start`
An entry's "after_start" override applies once `service start` ran."""
import json, os, pathlib, sys

d = pathlib.Path(os.environ["FAKE_OC_DIR"])
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
        entry = entry["after_start"]
    sys.stdout.write(entry.get("out", ""))
    sys.exit(entry.get("exit", 0))

sys.stderr.write("unsupported argv\n")
sys.exit(2)
