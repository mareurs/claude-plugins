# Claude Plugins Marketplace

Claude Code plugin marketplace. Primary active plugin: `code-explorer-routing`.

## Structure

```
.claude-plugin/marketplace.json  -- marketplace catalog (NO version fields here)
sdd/                             -- SDD plugin (stable)
  .claude-plugin/plugin.json     -- version source of truth
  hooks/, commands/, skills/     -- plugin content
tool-infra/                      -- DEPRECATED, do not modify
  .claude-plugin/plugin.json     -- version source of truth
  hooks/                         -- plugin content
code-explorer-routing/           -- companion plugin for code-explorer MCP server
  .claude-plugin/plugin.json     -- version source of truth
  hooks/                         -- tool routing, guidance injection, auto-indexing
  docs/plans/                    -- design and implementation docs
scripts/check-versions.sh       -- version consistency validator
```

## Active Development Focus

**When "the plugin" is mentioned without qualification, it refers to `code-explorer-routing`.**

- `code-explorer-routing` — **actively developed**, primary focus of all plugin work
- `sdd` — **stable**, no active development expected
- `tool-infra` — **DEPRECATED**, do not modify

## code-explorer-routing

**Companion plugin for the code-explorer MCP server.**

Intentionally tightly coupled to code-explorer — reads its SQLite DB, calls its CLI
binary, and references its internal schema (meta table, drift_report table, project.toml).
Update this plugin whenever code-explorer adds features that affect exploration workflows.

**What it does:**
- SessionStart/SubagentStart: injects `.code-explorer/system-prompt.md` content verbatim (project-specific guidance generated at onboarding)
- PostToolUse: soft warnings when Read/Grep/Glob are used on source files, suggests alternatives
- Auto-reindexing: checks index staleness at session start, triggers `code-explorer index` in background
- Drift warnings: surfaces high-drift files and stale docs/memories

**Dependencies:** `jq`, `sqlite3`, `git`, code-explorer binary on PATH or in MCP config

**Note:** MCP `server_instructions` ARE re-sent to each subagent's fresh MCP session — generic
tool routing guidance is already covered. The plugin only needs to inject dynamic, project-specific
content that `server_instructions` cannot carry (system-prompt.md, memory hints, drift warnings).

## Version Management

**Single source of truth**: each plugin's `.claude-plugin/plugin.json` is the canonical version.

**marketplace.json must NOT contain version fields.** Claude Code reads version from
plugin.json at install time. Duplicating it in marketplace.json causes drift.

### When bumping a plugin version

1. Update `<plugin>/.claude-plugin/plugin.json` — source of truth
2. Update the version table in `README.md`
3. Run `scripts/check-versions.sh` to verify consistency
4. Commit: `chore: bump <plugin> to <version>`

```bash
./scripts/check-versions.sh
```

Checks: plugin.json versions match README.md table, marketplace.json has no version fields.

## Development

- Hooks use `jq` for JSON parsing — required dependency
- Hook scripts use `${CLAUDE_PLUGIN_ROOT}` to reference files within the plugin install directory
- Test hooks locally: `echo '{"cwd":"/some/path"}' | bash code-explorer-routing/hooks/session-start.sh`

## Installing

```
/plugin marketplace add mareurs/claude-plugins
/plugin install code-explorer-routing@claude-plugins
/plugin install sdd@claude-plugins
```

For project-level setup, add to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-plugins": {
      "source": { "source": "github", "repo": "mareurs/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "code-explorer-routing@claude-plugins": true
  }
}
```
