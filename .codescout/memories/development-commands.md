# Development Commands

## Testing

```bash
# Root plugin (bash tests)
./tests/run-all.sh

# buddy plugin (Python tests)
cd buddy && pytest

# Version consistency check (before any bump)
./scripts/check-versions.sh
```

## Manual Hook Testing

```bash
# Hooks are node (.mjs), not bash — pipe the event JSON on stdin
echo '{"cwd":"/some/path","hook_event_name":"SessionStart"}' \
  | node codescout-companion/hooks/session-start.mjs

echo '{"cwd":"/some/path","tool_name":"Read","tool_input":{"file_path":"/src/foo.rs"}}' \
  | node codescout-companion/hooks/pre-tool-guard.mjs
```

The `.sh` names this section used to give (`session-start.sh`, `pre-tool-guard.sh`) no
longer exist — the hooks were ported to node. `*.test.sh` files are bash *test drivers*
for those hooks, not the hooks themselves.

**A guard test that reads your ambient config is not hermetic.** `pre-tool-guard.test.sh`
builds synthetic fixture projects (each with a `.mcp.json` whose command contains
`codescout`, so `detect.mjs`'s `/codescout/` regex matches) under its own temp dir. It
used to hardcode the two live repo checkouts as dispatch CWDs, which only worked on the
author's machine. It still exports `CS_COMPANION_IGNORE_PROJECT_CONFIG=1` so a developer's
`.claude/codescout-companion.json` opt-out cannot turn it red; set that env var if you
drive the hook by hand from a repo that carries an opt-out. See `guard-hardening-session-log:F-3`.
## Installing Plugins

```
/plugin marketplace add mareurs/claude-plugins
/plugin install codescout-companion@sdd-misc-plugins
/plugin install sdd@sdd-misc-plugins
```

**The marketplace key is `sdd-misc-plugins`** (the `name` in `.claude-plugin/marketplace.json`). It is what every install record and `release.sh` use, and `/plugin install …@claude-plugins` fails with "not found in marketplace" (verified 2026-11-09 on a clean profile). On this machine it is also a `source: directory` marketplace whose `installLocation` is the repo itself. **Hooks load from the working tree there; skills and commands load from the versioned cache** (see the repo `CLAUDE.md`, § Plugin Install Path).

## Version Bump (after tests pass)

**One command runs the whole dance** — do not do the steps by hand:

```bash
./scripts/release.sh <plugin> [patch|minor|major|X.Y.Z]   # default: patch
```

Gated, aborting on first failure: pre-flight (clean tree + `./tests/run-all.sh` + buddy
pytest) → bump `plugin.json` + the README table → `check-versions.sh` → commit → seed the
versioned cache in every profile that has the plugin (four here) → repoint `version` +
`installPath` in each install record → sanity loop → `check-profile-parity.sh` (step 6.5) → push. `NO_PUSH=1` dry-runs it;
`SKIP_TESTS=1` skips the suites. **The script header is authoritative.**

If step 6.5 reports `MARKETPLACE SKEW`, the release has already committed and seeded the caches but did not push. Refresh the stale marketplace clone from the profile with the newest HEAD (`rsync -a --delete`, after checking for symlinks), re-run `./scripts/check-profile-parity.sh`, then `git push`. Measured 2026-11-23: `superpowers-marketplace` sat at 5c90728 in `~/.claude-sdd` and `~/.claude-kat` and at 808dc47 in the other two.

Two steps it cannot do, both required afterwards:

1. Refresh the codescout `version-bump-checklist` tracker (needs the MCP tool):
   `doc(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)`, then verify
   every row — any ❌ is real drift.
2. **Cold-restart all four Claude Code instances**; a `resume` is not enough, since hook
   registration resolves at process launch. `/reload-plugins` works.

**Never bump the version inline in a feature commit.** It gets you the number without any
of the machinery the number promises: `check-versions.sh` compares `plugin.json` to the
README and never looks at install records, and `check-profile-parity.sh` runs only
*inside* `release.sh`. Measured 2026-08-28 — `1.19.5` was bumped this way and left
`~/.claude-kat` stranded at `1.19.4` with no cache dir for nine hours, with every
automated gate green throughout. See the 1.19.6 entry in the version-bump-checklist.
