---
kind: entry
status: open
title: 'Linux workstation: four Claude Code profiles are live, with their project-dir counts'
created: 2026-11-24
entry_kind: measurement
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- machine-linux
---

**All four Claude Code profiles are live and in use here** — `~/.claude`, `~/.claude-sdd`,
`~/.claude-kat`, `~/.claude-stef`. The list is `PROFILES` in `scripts/lib-profiles.sh`, and each
profile has a `claude-*` alias in `~/.bashrc`. Measured 2026-08-26 (the first three) and
2026-11-12 (all four):

- `claude` is on PATH at `~/.local/bin/claude`. `uname -sr` → `Linux 7.1.9-zen1-2-zen`
  (Arch zen kernel — **not** WSL, which reports `*-microsoft-standard-WSL2`).
- `~/.claude` (657 project dirs), `~/.claude-sdd` (183), `~/.claude-kat` (110),
  `~/.claude-stef` (26) — all four carry real session history, and `.claude-kat` is a routine
  working profile. (The 2026-08-26 counts for the first three were 256, 49 and 18.)

**Valid:** dated 2026-11-12
