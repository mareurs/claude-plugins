---
kind: entry
status: open
title: 'Windows work box (another host): scope note, and Git Bash is a per-user install'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-windows
---

> **Scope note, added 2026-08-26.** Everything in this section describes a *different,
> Windows* host. It was written without a machine label, and its claims are false on the
> Linux workstation — it asserts there is no `claude` binary, that "zero active
> Claude Code profiles exist", that `~/.claude-sdd` and `~/.claude-kat` "each contain a
> single empty scaffold entry and were never actually used", and that `release.sh`'s
> profile steps are no-ops. All four are contradicted by direct measurement here. Read it
> as Windows-only history; do not reason about profile state from it.

- **Git Bash is installed**, but not at the usual `C:\Program Files\Git`: it's a
  per-user install at `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` (also
  `...\usr\bin\bash.exe`). The bare `bash` on PATH resolves to Windows' WSL
  launcher stub instead, which fails (`WSL ... Relay ... execvpe failed`) —
  this machine's WSL previously had no Linux distro installed (only a stopped
  `docker-desktop` entry); an Ubuntu distro has since been added. Invoke Git
  Bash by full path, don't rely on bare `bash`/`bash.exe` resolving correctly
  in a plain PowerShell terminal.

**Valid:** dated 2026-08-05
