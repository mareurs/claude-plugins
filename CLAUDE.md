# Claude Plugins Marketplace

Personal Claude Code plugin marketplace with SDD and tool-infra plugins.

## Structure

```
.claude-plugin/marketplace.json  -- marketplace catalog (NO version fields here)
sdd/                             -- SDD plugin
  .claude-plugin/plugin.json     -- version source of truth
  hooks/, commands/, skills/     -- plugin content
tool-infra/                      -- semantic tool infrastructure plugin (DEPRECATED)
  .claude-plugin/plugin.json     -- version source of truth
  hooks/                         -- plugin content
code-explorer-routing/           -- companion plugin for code-explorer MCP server
  .claude-plugin/plugin.json     -- version source of truth
  hooks/                         -- tool routing, guidance injection, auto-indexing
  docs/plans/                    -- design and implementation docs
scripts/check-versions.sh       -- version consistency validator
```

## code-explorer-routing

**Companion plugin for the [code-explorer](../code-explorer) MCP server.**

This plugin is intentionally tightly coupled to code-explorer. It should be updated
whenever code-explorer adds features that affect exploration workflows. The coupling
is by design — the plugin reads code-explorer's SQLite DB, calls its CLI binary,
and references its internal schema (meta table, drift_report table, project.toml config).

**What it does:**
- SessionStart/SubagentStart: injects tool-selection guidance (prefer symbol tools over Read)
- PreToolUse: blocks Read/Grep/Glob on source files, redirects to code-explorer tools
- Auto-reindexing: checks index staleness at session start, triggers `code-explorer index`
- Drift warnings: surfaces high-drift files and stale docs/memories

**Dependencies:** `jq`, `sqlite3`, `git`, code-explorer binary on PATH or in MCP config

## Version Management

**Single source of truth**: each plugin's `.claude-plugin/plugin.json` is the canonical version.

**marketplace.json must NOT contain version fields**. Claude Code reads version from plugin.json at install time. Duplicating it in marketplace.json causes drift (this has already burned us).

### When bumping a plugin version

1. Update `<plugin>/.claude-plugin/plugin.json` -- this is the source of truth
2. Update the version table in `README.md`
3. Run `scripts/check-versions.sh` to verify consistency
4. Commit with message: `chore: bump <plugin> to <version>`

### Validation

```bash
./scripts/check-versions.sh
```

Checks:
- Every plugin.json version matches the README.md table
- marketplace.json contains no version fields

Run this before every version bump commit.

## Development

- Hooks use `jq` for JSON parsing -- it's a required dependency
- Hook scripts use `${CLAUDE_PLUGIN_ROOT}` to reference files within the plugin install directory
- Test hooks locally: `echo '{"cwd":"/some/path"}' | bash tool-infra/hooks/session-start.sh`

## Installing from this marketplace

```
/plugin marketplace add mareurs/claude-plugins
/plugin install tool-infra@sdd-misc-plugins
/plugin install sdd@sdd-misc-plugins
```

For team setup, add to project `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "sdd-misc-plugins": {
      "source": { "source": "github", "repo": "mareurs/sdd-misc-plugins" }
    }
  },
  "enabledPlugins": {
    "tool-infra@sdd-misc-plugins": true
  }
}
```
