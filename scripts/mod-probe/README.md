# mod-probe

One short `claude -p` session that measures, on the machine it runs on:

- whether a user-tier mod loads, and which events reach it under the account's policy (a team organization bypasses `classic.*` and `prompt.compose`);
- what a file read and a process start (`git`, `node`, `python`) cost from inside Claude Code;
- what each installed command hook cost in the same session.

Run it from a git checkout. It spends a few Haiku turns.

```bash
bash scripts/mod-probe/run.sh                                        # Linux, macOS, Git Bash
powershell -ExecutionPolicy Bypass -File scripts\mod-probe\run.ps1   # Windows
```

The summary is printed and saved to `scripts/mod-probe/run/summary.txt`, beside the debug log.
