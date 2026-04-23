# Buddy Plugin Migration Design

**Date:** 2026-04-23
**Status:** approved

## Problem

`buddy` lives at `/home/marius/agents/buddy-plugin` (own git repo, no remote) and is
referenced in `claude-plugins` via a symlink. It is already installed as
`buddy@sdd-misc-plugins` but its source is outside the repo. All other plugins in
`claude-plugins` are real directories — buddy should be too.

## Goal

Migrate `buddy` into `claude-plugins` as a first-class plugin: real directory, marketplace
entry, version bumped to signal the move, all external references updated, old source repo
deleted.

## Scope

- No history preservation (98 local commits, no remote — squash is acceptable)
- Marketplace registration required
- `.buddy/` runtime state dir gitignored
- Old path `/home/marius/agents/buddy-plugin` deleted after migration

## Approach: Migrate + Version Bump + Gitignore

### 1. Repo changes

- Remove symlink `buddy` → replace with real directory (copy of `/home/marius/agents/buddy-plugin`)
- Add `.buddy/` to `.gitignore`
- Add `buddy` entry to `.claude-plugin/marketplace.json` (no `version` field — per project rule)
- Bump `buddy/.claude-plugin/plugin.json` version `0.1.1 → 0.1.2`
- Update `README.md` version table

### 2. Config updates (outside repo)

| File | Change |
|---|---|
| `~/.claude-sdd/settings.json` | `statusLine.command` → new cache path `/home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.2/scripts/statusline-composed.sh` |
| `~/.claude/plugins/installed_plugins.json` | `installPath` + `version` → `0.1.2` cache entry |
| `~/.claude-sdd/plugins/installed_plugins.json` | same |

Note: `~/.claude/.claude.json` has a project history entry for the old path — this is
inert conversation history, leave as-is.

### 3. Cleanup

1. Delete `/home/marius/agents/buddy-plugin`
2. Commit: `chore: migrate buddy plugin into repo, bump to 0.1.2`
3. Push
4. Restart both Claude Code instances (cache reseeds from new installPath)

## marketplace.json entry

```json
{
  "name": "buddy",
  "description": "A Himalayan-aesthetic bodhisattva companion for Claude Code, with 10 specialist masters on demand.",
  "source": { "source": "directory", "path": "buddy" }
}
```

## Out of scope

- Modifying buddy's internals
- Adding tests for buddy to `tests/run-all.sh`
- Migrating `.claude.json` project history entry
