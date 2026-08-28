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
hardcodes the two live repo checkouts as its dispatch CWDs, so a `.claude/codescout-companion.json`
opt-out in either turns the suite red. It exports `CS_COMPANION_IGNORE_PROJECT_CONFIG=1`
to stay independent of it; set that env var if you drive the hook by hand from a repo
that carries an opt-out. See `guard-hardening-session-log:F-3`.
## Installing Plugins

```
/plugin marketplace add mareurs/claude-plugins
/plugin install codescout-companion@claude-plugins
/plugin install sdd@claude-plugins
```

**On this machine the marketplace key is `sdd-misc-plugins`, not `claude-plugins`** — that
is what `.claude-plugin/marketplace.json`, every install record and `release.sh` use. The
`claude-plugins` name above is the public install path for a fresh user. It is also a
`source: directory` marketplace here, whose `installLocation` is the repo itself, so plugin
content is served from the working tree.

## Version Bump (after tests pass)

**One command runs the whole dance** — do not do the steps by hand:

```bash
./scripts/release.sh <plugin> [patch|minor|major|X.Y.Z]   # default: patch
```

Gated, aborting on first failure: pre-flight (clean tree + `./tests/run-all.sh` + buddy
pytest) → bump `plugin.json` + the README table → `check-versions.sh` → commit → seed the
versioned cache in all **three** profiles → repoint `version` + `installPath` in all three
install records → `check-profile-parity.sh` → sanity loop → push. `NO_PUSH=1` dry-runs it;
`SKIP_TESTS=1` skips the suites. **The script header is authoritative.**

Two steps it cannot do, both required afterwards:

1. Refresh the codescout `version-bump-checklist` tracker (needs the MCP tool):
   `artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)`, then verify
   every row — any ❌ is real drift.
2. **Cold-restart all three Claude Code instances**; a `resume` is not enough, since hook
   registration resolves at process launch. `/reload-plugins` works.

**Never bump the version inline in a feature commit.** It gets you the number without any
of the machinery the number promises: `check-versions.sh` compares `plugin.json` to the
README and never looks at install records, and `check-profile-parity.sh` runs only
*inside* `release.sh`. Measured 2026-08-28 — `1.19.5` was bumped this way and left
`~/.claude-kat` stranded at `1.19.4` with no cache dir for nine hours, with every
automated gate green throughout. See the 1.19.6 entry in the version-bump-checklist.
