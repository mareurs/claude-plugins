---
kind: bug
status: fixed
opened: 2026-11-05
closed: 2026-11-05
title: Constitution hooks cannot find the codescout binary off PATH
---

# Constitution hooks cannot find the codescout binary off PATH

`constitution-guard.mjs` and `constitution-brief.mjs` spawn bare `codescout` via
`execFileSync`, so they only work when the binary is on the hook process PATH. When it is
not, `execFileSync` throws, the catch does `process.exit(0)`, and constitution
enforcement silently never happens.

## Evidence

- `codescout-companion/hooks/constitution-guard.mjs:30` runs
  `execFileSync('codescout', ['constitution-check', '--path', targetPath, '--project', cwd], ...)`.
- `codescout-companion/hooks/constitution-brief.mjs:49` runs
  `execFileSync('codescout', ['constitution-check', '--project', cwd], ...)`.
- On this machine `codescout` lives only in `~/.cargo/bin` (a symlink to the release
  build), and no running `claude` process has that directory on PATH, so both hooks exit
  silently today.
- `codescout-companion/hooks/goal-stop-hook.mjs:40-62` already has a local
  `resolveCodescout()` (PATH dirs, then `~/.cargo/bin/codescout`, then
  `<cwd>/target/release/codescout`) that handles this; the constitution hooks do not use it.

## Fix

Move the resolver into `lib.mjs` as `resolveCodescoutBinary(cwd)` (adding
`detect().CS_BINARY` as the second candidate) and use it in all three hooks.

## Resolution

Fixed 2026-11-05. Covered by the `binary only in ~/.cargo/bin` and `binary nowhere` cases in
`codescout-companion/hooks/constitution-guard.test.sh` and
`codescout-companion/hooks/constitution-brief.test.sh`. The goal-stop-hook matrix test now
unsets `CLAUDE_CONFIG_DIR` so `detect()` cannot find the real binary and defeat its
`binary-missing` branch.
