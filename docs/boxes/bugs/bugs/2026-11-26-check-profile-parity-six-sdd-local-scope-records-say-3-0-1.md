---
kind: entry
status: open
title: release.sh stages the whole README.md, so a peer session's edit made during the run lands in the release commit (session-bridge 0.4.0 swept an sdd 3.0.2 row)
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
- '2026-11-26 edited:title codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
severity: low
status_since: 2026-11-26
---

## Summary

`scripts/release.sh` runs its clean-tree check at step 0 and `git add "$PLUGIN_JSON" README.md` at step 3 (`scripts/release.sh:70` and `:100`), minutes apart. `git add README.md` stages the whole file, so an edit that a peer session makes to `README.md` between those two steps lands in the release commit. This happened on 2026-11-26 in the `session-bridge` 0.4.0 release.

## What happened (read at the bytes)

- Commit `5dbecce` (`chore: bump session-bridge to 0.4.0`) changes two rows of the README version table: the `session-bridge` row (`0.3.3` to `0.4.0`, which is the release's own `sed` at `release.sh:94`) and the `sdd` row (`3.0.1` to `3.0.2`, which the release never touches: its `sed` matches only `$PLUGIN`).
- At the end of the run `sdd/.claude-plugin/plugin.json` was modified and not committed (`3.0.1` at HEAD, `3.0.2` in the working tree), and no `release.sh` process was running. So another session had started to bump `sdd` to `3.0.2` (plugin.json and README) while the release ran, and its README edit was swept into `5dbecce`.
- Effect now: HEAD has README `sdd 3.0.2` and `sdd/.claude-plugin/plugin.json` `3.0.1`; the four profile caches and records hold `3.0.1`. `check-profile-parity.sh` (full run) reads the working tree and reports six `STALE: sdd ... records 3.0.1, canonical is 3.0.2`. The `check-versions.sh` gate of the release also read the peer's uncommitted `3.0.2` and passed.

## Correction

An earlier version of this entry said that commit `b52f029` was titled 3.0.1 but wrote 3.0.2. That was a misreading of `git show` output: a pickaxe for `"version": "3.0.2"` in the plugin.json history finds no commit. The committed plugin.json has always said `3.0.1`.

## Fix direction (not done)

- `release.sh` should stage only the lines it changed, or refuse when `README.md` or any `plugin.json` differs from the version it read at step 0 (re-check `git status --porcelain` right before step 3).
- The `sdd` release itself belongs to the session that started it; this entry does not cover it.
