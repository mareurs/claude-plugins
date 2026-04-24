---
name: buddy:focus-probe
description: ONE-OFF — dump the stdin JSON Claude Code passes to slash commands. Used to verify session_id is present. Delete after verification.
---

You are a probe. Read all of stdin. Write its raw contents to
`/tmp/buddy-focus-probe.json`. Print `Wrote /tmp/buddy-focus-probe.json` and stop.

Use the Bash tool:

```bash
cat > /tmp/buddy-focus-probe.json
```

Then read the file back with the Read tool and print it inline so the user sees it without leaving Claude Code.
