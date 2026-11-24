---
kind: entry
status: open
title: 'Linux workstation: CS_PRIVACY=off is set in the env of all four profiles'' settings.json'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:60191745-8385-42b3-956d-68380922a272'
status_since: 2026-11-24
topics:
- machine-linux
---

Set 2026-11-24 in `~/.claude`, `~/.claude-sdd`, `~/.claude-kat` and `~/.claude-stef` (`env.CS_PRIVACY`, value `off`). A session reads it at start, so a running session needs a restart. Effect: `codescout-companion:export-feedback` exports raw text on this machine. The default elsewhere is on (redacted).

Check: `for p in .claude .claude-sdd .claude-kat .claude-stef; do python3 -c "import json,os;print('$p',json.load(open(os.path.expanduser('~/$p/settings.json')))['env'].get('CS_PRIVACY'))"; done` prints `off` four times.

A new profile needs the same line. `scripts/lib-profiles.sh` names the profiles.
