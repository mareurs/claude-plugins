---
id: '350a804417d008ce'
kind: bug
status: fixed
title: Marketplace registrations drifted cross-profile in two files the parity gate never read, and the pointer hid a three-month-stale clone of an enabled plugin
tags:
- profiles
- release-pipeline
- parity
- roster-audit
closed: 2026-08-26
fix_patch_id: 176d0001c4f33b8d65f6978fa5a82d482a37a58b
fix_sha: d8030bd (main)
opened: 2026-08-26
severity: med
unverified: 'The refresh was a one-time rsync from ~/.claude, not an automated sync — nothing keeps the three profiles'' marketplace clones current, so HEAD skew will reappear whenever one profile auto-updates and another does not. The gate now DETECTS that (class 7) but never repairs it. Also: claude-plugins-official is not a git clone in any profile, so class 7 cannot see its staleness at all — kat''s copy was 180 plugins vs .claude''s 289 before the sync, and only a file count revealed it.'
---

## Summary

`./scripts/check-profile-parity.sh` reported `Profile parity holds` while three separate
cross-profile faults were live. The gate read `installed_plugins.json` and nothing else;
marketplace **registration** lives in `known_marketplaces.json`, and marketplace **content**
lives in a directory that neither file describes.

Found while verifying that `buddy 0.9.2` was actually live after `/reload-plugins` — the
probe was aimed at plugin freshness and hit this instead.

## Symptom (Effect)

Measured 2026-08-26, all three profiles:

1. **Cross-profile registration.** `~/.claude-kat/plugins/known_marketplaces.json` recorded
   `installLocation` under `~/.claude/plugins/marketplaces/…` for **five of six**
   marketplaces. `.claude` and `.claude-sdd` each correctly owned theirs. `superpowers` is
   enabled in kat, so this profile was loading an enabled plugin out of a sibling profile.
2. **Symlinked marketplace dir.** `~/.claude-sdd/plugins/marketplaces/caveman` was a symlink
   to `~/.claude/plugins/marketplaces/caveman`, dated 2026-04-14 — identical coupling,
   different mechanism, invisible to any JSON-level check.
3. **Stale local clones, masked by (1).** kat's own copies had rotted:

| marketplace | kat (before) | `.claude` / `.claude-sdd` |
|---|---|---|
| `superpowers-marketplace` | `91cb319` 2026-05-06, 47 files | `1ab7b8e` 2026-08-12, 159 files |
| `anthropic-agent-skills` | `5128e18` 2026-04-23 | `3b3fad9` 2026-08-21 |
| `caveman` | `63e797c` 2026-04-12 | `0d95a81` 2026-07-03 |
| `claude-plugins-official` | 180 plugins, 359 files (not git) | 289 plugins, 442 files |

## The trap — the obvious fix is a regression

Repointing kat at its own copies, which is what the drift class name suggests and what a
one-line repair would do, **would have downgraded `superpowers` from 2026-08-12 to
2026-05-06.** The cross-profile pointer was not merely wrong; it was the only reason kat was
serving current code, silently compensating for its own local rot.

**Refresh the local copy, then repoint. Never the reverse.** This is now in the script's
failure hint, because the moment someone reads `MARKETPLACE CROSS-PROFILE` the tempting fix
is exactly the wrong one.

Generalised: **a pointer that papers over a fault also suppresses the signal for it.** Nobody
noticed kat's clones were three months old *because* kat never read them. The staleness
becomes visible only at the instant the pointer is corrected — the worst possible moment,
since it arrives disguised as a regression caused by the fix.

## Reproduction

```
for P in .claude .claude-sdd .claude-kat; do
  jq -r 'to_entries[] | "\(.key): \(.value.installLocation)"' ~/$P/plugins/known_marketplaces.json
  find ~/$P/plugins/marketplaces -maxdepth 1 -type l
  for d in ~/$P/plugins/marketplaces/*/; do
    [ -d "$d/.git" ] && echo "$(basename $d) $(git -C "$d" rev-parse --short HEAD)"
  done
done
```

## Root cause

The gate's name promises profile parity; its scope was one file. Same law as
`roster-audit-session-log:F-7` one level out — there, three checks all read array element
`[0]`; here, a whole gate read one file of three. A check that inspects only where the
writer wrote cannot fail.

Contributing: nothing in the repo ever asserted where marketplace content is *supposed* to
live per profile, so a hand-edit or an old `/plugin marketplace add` run from the wrong
profile left no trace anything could compare against.

## Related finding — the cache is not the load path

While probing this: `sdd-misc-plugins` is registered as a `directory` source whose
`installLocation` is the repo itself, and `.buddy/.session-start-trace.log` shows every hook
resolving `plugin_root=/home/marius/work/claude/claude-plugins/buddy` — including entries
written *after* a release repointed `installPath` at a versioned cache dir.

So for this repo's plugins, content is served from the **working tree**; `bump-cache.sh`
seeding and `installPath` repointing are belt-and-braces, not the load path. A restart or
`/reload-plugins` still matters, but for *registration* (which hooks/skills/commands exist,
resolved at launch), not for byte freshness. `CLAUDE.md` said the opposite by implication and
is corrected in the same commit.

## Fix

1. `rsync -a --delete` kat's five marketplace copies from `~/.claude` — **first**.
2. Replaced sdd's `caveman` symlink with a real directory copy.
3. Repointed kat's `installLocation` values to its own profile, leaving `sdd-misc-plugins`
   pointing at the repo (correct — it is a `directory` source).
4. Extended `scripts/check-profile-parity.sh` with three classes and one assertion:
   - **class 5 MARKETPLACE CROSS-PROFILE** — `installLocation` escaping its profile, with a
     `directory`-source exemption
   - **class 6 MARKETPLACE SYMLINK** — a symlinked `marketplaces/<name>`
   - **class 7 MARKETPLACE SKEW** — same marketplace at different git HEADs across profiles,
     the fault class 5 hides
   - **MARKETPLACE MISMATCH** — a `directory` source whose `installLocation` disagrees with
     its declared `source.path`
5. `CLAUDE.md` § *This Machine* and § *Plugin Install Path* record the load-path measurement
   and the refresh-then-repoint ordering.

## Tests added

No unit test — the check reads real profile directories under `$HOME`. Verified instead by
**positive control**: a synthetic three-profile tree under a temp `HOME` with one case per
new state (cross-profile `installLocation`, symlinked dir, two git repos at differing HEADs,
and a `directory` source with a mismatched `installLocation`). All four fired, exit 1. The
real tree then reported `OK: marketplace registrations — every installLocation owns its
profile, no symlinks, no HEAD skew`.

A green gate after a fix is uninformative on its own — it reads identical whether the checks
work or not — so the control is the evidence, not the green.

## Method note — I wrote through the symlink before checking for one

Syncing kat, I also rsynced `~/.claude`'s caveman into sdd's caveman, which was a symlink
back to `~/.claude`'s caveman. Source and destination resolved to the same tree, so
`rsync -a --delete` was inert; `~/.claude`'s copy verified intact afterwards (206 files,
`0d95a81`). It cost nothing only because the accident was reflexive.

Rule earned: **enumerate symlinks in a tree before rsyncing into it**, especially with
`--delete`, and most of all when cross-profile coupling is the very thing being repaired —
links between the trees are then known to exist. Now class 6.

## Workarounds

None needed.

## References

- `roster-audit-session-log:F-10` — the reconnaissance entry this issue is filed from
- `roster-audit-session-log:F-7` — the same law one level in (`[0]`-only reads)
- `scripts/check-profile-parity.sh` — classes 5–7, and the failure hint carrying the ordering rule
- `CLAUDE.md` § *This Machine — Linux workstation*, § *Plugin Install Path (directory-source gotcha)*

