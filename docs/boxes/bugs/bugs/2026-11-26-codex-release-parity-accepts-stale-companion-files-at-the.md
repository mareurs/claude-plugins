---
kind: entry
status: open
title: Codex release parity accepts stale companion files at the same version
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:anonymous'
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

Pending.

## Tests added

None for this filing. Reproduce with an installed trusted plugin and two same-version payloads. Pin applied sync and read-only check separately, with an unchanged-payload control.

## Resume

Decide what local-marketplace contents the release parity check must compare. Preserve Codex's native hook approval flow when a re-copy changes the installed content.
