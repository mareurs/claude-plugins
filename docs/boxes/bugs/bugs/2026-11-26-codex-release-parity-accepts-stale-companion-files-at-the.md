---
kind: entry
status: fixed
title: Codex release parity accepts stale companion files at the same version
closed: 2026-11-26
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:anonymous'
- '2026-11-26 open -> fixed codescout:anonymous'
severity: medium
status_since: 2026-11-26
---

## Summary

`scripts/sync-codex.py --check` reports a healthy installation when the installed version directory exists and its hooks are trusted for the installed bytes. A local marketplace can hold different bytes under the same version. The parity check still passes, and the sync path skips the re-copy.

## Symptom

In Codex CLI 0.172.0, the installed Codescout Companion and local marketplace both declared 1.23.9. The active hook still suggested `ToolSearch` after restart, and the installed reconnaissance counter still selected a synthetic peer session in a read-only resolver probe. The local source includes both fixes. A byte comparison showed the installed and source copies of `hooks/pre-tool-guard.mjs`, `hooks/session-start.mjs`, `skills/reconnaissance/SKILL.md` and `skills/reconnaissance/recon_count.py` differed.

The checker printed:

```text
codex codescout-companion 1.23.9: 27 hook(s) trusted, 0 to renew, 0 to review
```

The command exited 0.

## Reproduction

Use a local marketplace and an installed, trusted companion. Change a shipped hook in the local source without changing its manifest version. Compare the same hook in the marketplace and the cache, then run `python3 scripts/sync-codex.py codescout-companion 1.23.9 --check`. A restart reuses the installed bytes; this probe used the existing 1.23.9 installation and made no configuration or cache changes.

## Root cause

`scripts/sync-codex.py:131` treats the version directory as the freshness witness. Re-copy happens only if the directory is absent. `hooks/list` then validates trust against the installed content, so the old hook can be trusted while its local source differs.

## Evidence

The active app-server located companion hooks under `~/.codex/plugins/cache/sdd-misc-plugins/codescout-companion/1.23.9/hooks/hooks.json`. A guarded `cat CLAUDE.md` in Codex reproduced the old message. Source fixes: `81919fb` and `ef35b93`.

## Fix

For a registered local marketplace, `sync-codex.py` builds a reference cache with the Codex installer in a temporary profile. Comparing both file sets and their contents covers omitted, obsolete and modified files, including skills Codex generates from commands. `--check` reports stale bytes and leaves the live profile read-only. Applied sync refreshes through `codex plugin add` and checks the new cache before evaluating existing hook approvals.

## Verification

The scratch-profile suite went from five failing stale-cache cases to 26 passing checks. It covers same-version source drift, stale generated skills, obsolete files, read-only checking, trusted fresh copies, content-only approval renewal, changed declarations, disabled plugins and registration when a cache already exists. The release guard passed five checks and the installed-profile suite passed 20.

Against the existing Companion 1.23.9 profile on Codex 0.172.0, `--check` returned exit 1 and reported `hooks/host-text.test.sh` as the first differing path.

## Closed

Fixed in the release scripts and verified against Codex 0.172.0.
