---
kind: entry
status: open
title: 'check-profile-parity: six sdd local-scope records say 3.0.1 while plugin.json says 3.0.2 (commit b52f029 is titled 3.0.1)'
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
severity: low
status_since: 2026-11-26
---

## Summary

`./scripts/check-profile-parity.sh` (the full run, without a plugin argument) exits 1 on 2026-11-26 because six `sdd` install records say `3.0.1` while `sdd/.claude-plugin/plugin.json` and the README row say `3.0.2`. The `session-bridge` 0.4.0 release is not the cause: its own plugin-scoped parity gate passed and the full run prints `OK: session-bridge 0.4.0 — parity across 4 profile(s)`.

## Symptom (Effect)

Measured 2026-11-26 after `NO_PUSH=1 ./scripts/release.sh session-bridge minor`, at main `5dbecce`:

- `STALE: sdd in ~/.claude`, `~/.claude-sdd`, `~/.claude-kat`, `~/.claude-stef`: element `[0]`, `scope=local`, `projectPath=/home/marius/work/claude/claude-plugins`, records `3.0.1`, canonical `3.0.2`.
- `STALE: sdd in ~/.claude-kat` and `~/.claude-stef`: element `[1]`, `scope=local`, `projectPath=/home/marius/work/claude/claude-plugins.worktrees/session-channel`, records `3.0.1`.
- `git log -- sdd/.claude-plugin/plugin.json`: the newest commit is `b52f029` (2026-11-11), subject `chore: bump sdd to 3.0.1`, yet `jq .version` on the file gives `3.0.2` and a pickaxe for `"version": "3.0.2"` finds that same commit. The commit subject and the version it wrote disagree.

## Why it matters

The version-bump-checklist tracker reads every element of every record, so this row reads red; `sdd` is a `local`-scope install that Claude Code writes per project (the tracker prompt says so), so `release.sh sdd` cannot repoint it the way it repoints the user-scope record.

## Not decided

- Whether `3.0.1` or `3.0.2` is the intended version of the `b52f029` commit.
- Whether the `session-channel` worktree record (a path that may no longer exist) should be removed instead of repointed (the parity script's own note: "may be deliberate; check projectPath before removing anything").
