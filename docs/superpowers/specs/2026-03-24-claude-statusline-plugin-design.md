# claude-statusline Plugin Design

## Overview

A Claude Code plugin that provides a rich, color-coded terminal status line. Opinionated and fixed — no configuration, no hooks. Users install the plugin, run a setup command, and add one line to `settings.json`.

## What It Shows

A single-line ANSI-colored display (left to right):

1. **Model badge** — purple background, e.g. `claude-opus-4`
2. **Agent badge** (conditional) — blue background, shown only when in a subagent
3. **Context %** — percentage of context window used (green → yellow → orange → red)
4. **Rate limits** — 5-hour and 7-day percentages with same color thresholds
5. **Git info** — branch name, or `wt:<name> on <branch>` if in a worktree
6. **Lines changed** — green `+N` / red `-N`
7. **Cache stats** (right-aligned) — cache creation/read tokens in `k` units
8. **Cost** — session total in USD (2 decimal places)
9. **Duration** — elapsed time (`Xs`, `XmYs`, `XhYm`)

## Plugin Structure

```
claude-statusline/
  .claude-plugin/
    plugin.json           # name, version, description, author, license
  bin/
    statusline.sh         # the status line script (source of truth)
  commands/
    setup-statusline.md   # /setup-statusline slash command
  README.md               # install instructions, screenshot, requirements
```

### No hooks. No skills. No agents.

## Components

### `bin/statusline.sh`

The existing `~/.claude/statusline.sh` script. Reads JSON from stdin (provided by Claude Code), outputs ANSI-colored line to stdout.

**Version stamp:** First line after the shebang is `# claude-statusline v<version>` so users can tell if their installed copy is stale.

**Dependencies:** `jq` (required), `git` (optional, for branch name fallback).

**Error handling:** No `set -e`. Graceful degradation — exits 0 on any error so the status line never crashes Claude Code.

### `commands/setup-statusline.md`

An LLM-instruction slash command (`/setup-statusline`). When invoked, the agent executes these steps:

1. **Discover plugin install path** — read `~/.claude/plugins/installed_plugins.json`, find the `claude-statusline@claude-plugins` entry, extract `installPath`
2. **Copy the script** — if `~/.claude/statusline.sh` already exists, warn the user and ask before overwriting. Copy `<installPath>/bin/statusline.sh` to `~/.claude/statusline.sh` and `chmod +x`
3. **Configure settings.json** — read `~/.claude/settings.json`, check if `statusLine` key exists. If not, add `"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }` and write back
4. **Instruct user to restart** Claude Code to pick up the changes

Users run this on first install AND after plugin updates to pick up script changes.

### `plugin.json`

```json
{
  "name": "claude-statusline",
  "description": "Rich, color-coded terminal status line showing model, context %, rate limits, git info, cost, and more.",
  "version": "1.0.0",
  "author": { "name": "Marius" },
  "license": "MIT",
  "keywords": ["statusline", "status", "terminal", "ui"]
}
```

### `README.md`

Sections:
- What it does (one sentence + screenshot/example)
- Requirements (`jq`)
- Installation steps (3 steps: install plugin, run `/setup-statusline`, add config, restart)
- Updating (run `/setup-statusline` again after plugin updates)
- What each field means (brief table)

## Marketplace

The plugin lives in this repo (`claude-plugins`) alongside `codescout-companion` and `sdd`. Added to `.claude-plugin/marketplace.json` as a new entry. No version field in marketplace (per project rules).

## User Flow

1. `/plugin marketplace add mareurs/claude-plugins` (if not already added)
2. `/plugin install claude-statusline@claude-plugins`
3. Run `/setup-statusline` (copies script, configures settings.json, prompts restart)

On updates: run `/setup-statusline` again to refresh the script.

## Non-Goals

- No configuration/themes — opinionated, take-it-or-leave-it
- No hooks — no SessionStart detection of stale scripts
- No auto-update of `~/.claude/statusline.sh` on plugin version changes
- No support for non-bash environments (Windows)

## Testing

A smoke test: pipe sample JSON through `bin/statusline.sh`, verify it exits 0 and produces non-empty output. Added to `tests/` and picked up by `run-all.sh`.

## Version Management

Follows the standard repo procedure: bump `plugin.json`, update README.md table, run `check-versions.sh`, update `installed_plugins.json` in both instances.
