---
title: Plugin install sync — cover GitHub Copilot + guard against force-push data loss
date: 2026-07-08
status: draft
topic: plugin-install-sync
---

# Plugin install sync — extend release.sh to Copilot, add a force-push safety net

## Problem

Today's session needed to manually reconcile a lost fix and then hand-update installs across
**two entirely separate plugin-loading systems**:

1. **Claude Code** — 3 profiles (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`), each with a
   versioned cache dir (`plugins/cache/<marketplace>/<plugin>/<version>/`) and an
   `installed_plugins.json` install record. `scripts/release.sh` + `scripts/bump-cache.sh`
   already automate this end-to-end (version bump → README → commit → cache seed → record
   repoint → sanity → push).
2. **GitHub Copilot CLI/Chat** — a *different* app entirely, with its own marketplace registry
   (`.copilot/config.json`, JSONC with a `// comment` header — not strict JSON) and a single
   **unversioned, flat** cache dir per plugin (`.copilot/installed-plugins/<marketplace>/<plugin>/`,
   no per-version subdirectory). `release.sh` has **zero awareness of this surface** — it was
   never touched by any release, so this machine's Copilot cache was stuck at buddy 0.7.29 /
   codescout-companion 1.11.15 while `main` had moved to 0.7.35 / 1.12.2.

Separately, this session traced *why* a fix needed reconstructing at all: a force-push to
`main` (`b201e0d...c113b14`) silently dropped 3 already-merged commits, because a concurrent
65-commit line of work was based on the pre-merge snapshot. No revert/rejection commit exists
anywhere in the history — this was collision, not a decision. `release.sh`'s own `git push`
(plain, no `--force-with-lease`) would not by itself have caused this, but nothing in the repo
would have *caught* it either, on either side of the collision.

## Constraint

- Copilot's cache is unversioned (flat-copy, not `<plugin>/<version>/`) — the same seeding
  logic as `bump-cache.sh` (which is version-dir-shaped) doesn't directly apply; it needs its
  own small script.
- `.copilot/config.json` is JSONC (leading `//` comments) — `jq` chokes on it directly; edits
  need either a comment-stripping pass or plain text substitution (this session used the
  latter, safely, since the version fields are simple `"version": "X.Y.Z"` scalars).
- Not every developer machine has a Copilot install (`.copilot/` may not exist at all) — must
  be a soft-skip, exactly like `release.sh` already soft-skips missing Claude profiles.
- CI cannot reach any of these caches — they're per-developer-machine local state, not
  repo-resident. This rules out a CI-only fix for the *sync* half of the problem (see
  Non-goals). The *force-push guard* half, however, doesn't need machine access at all.

## Fix #1 — `scripts/sync-copilot.sh <plugin> <version>`

New script, mirrors `bump-cache.sh`'s contract but for Copilot's flat-cache shape:

```
scripts/sync-copilot.sh buddy 0.7.36
scripts/sync-copilot.sh codescout-companion 1.12.3
```

Steps: locate `.copilot/config.json` (default `~/.copilot/config.json`, skip silently if
absent — no Copilot install on this machine); for the named plugin, read its
`cache_path` from the JSONC config via a comment-strip + `jq` pass (read-only, safe); wipe
and `cp -a` the repo source into that path (same exclude-prune as the `bump-cache.sh`
fallback — reuse a shared `scripts/lib-copy-plugin.sh` helper instead of duplicating the
`find -exec rm` block introduced in this session's `bump-cache.sh` fix, to avoid a third
copy of the same exclude list drifting out of sync); then patch the `"version": "..."` line
for that plugin's object in `config.json` via a scoped sed (JSONC-safe: match within the
plugin's own object bounded by its `"name": "<plugin>"` line, not a blind global replace —
guards against a same-version-string collision between plugins).

Wire it into `release.sh` as an additional best-effort step after `bump-cache.sh`, gated the
same way missing Claude profiles already are (`[ -f ... ] || skip`).

## Fix #2 — `scripts/check-branch-safety.sh <branch>`

A push-time guard, run as **step 0.5** of `release.sh` (after the existing clean-tree
preflight, before any commit): before pushing, fetch and check
`git merge-base --is-ancestor <local <branch> tip-before-this-run> origin/<branch>`. If the
remote tip is **not** a descendant of what we last knew locally (i.e. someone force-pushed
since our last fetch), abort with a loud message instead of proceeding — this is exactly the
check that would have surfaced today's incident at push time on the *other* session, not
discovery-by-accident weeks later on this one.

Opt-in as a local `pre-push` git hook (`scripts/install-hooks.sh` copies it into
`.git/hooks/pre-push`) rather than silently modifying anyone's `.git/hooks/` — hooks are
local-only and don't sync via clone, so this needs an explicit one-time install step,
documented in CLAUDE.md's "When bumping a plugin version" section.

## Non-goals

- **No CI-driven release pipeline.** A GitHub Actions runner cannot write to a developer's
  local `~/.claude*` or `.copilot/` directories — the cache-seed and install-record steps are
  inherently machine-local. CI could auto-bump `plugin.json`/README on merge, but that only
  covers the repo-side third of the existing `release.sh` contract and would fragment "the
  version bump" across two systems (a bot commit + a manual local finish) instead of one
  command — rejected as net-negative today. Revisit only if profile/cache state ever moves
  server-side (e.g. a shared plugin registry) — not the case now.
- **No branch protection / required-review settings change.** That's a GitHub repo-settings
  change (shared infrastructure) outside what an agent should flip unilaterally; the pre-push
  hook is the local, reversible equivalent and is proposed instead.
- **No change to `bump-cache.sh`'s versioned-cache contract for Claude Code** — Copilot's
  flat-cache shape is different by design (Copilot has no concept of "cache dir per version");
  `sync-copilot.sh` is deliberately a separate script, not a generalization of `bump-cache.sh`.
