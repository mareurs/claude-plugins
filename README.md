# Claude Plugins

An opinionated collection of Claude Code plugins, primarily developed for internal team use. Public so colleagues and collaborators can install directly.

These plugins reflect specific workflows and tool choices -- they may not suit every setup. Feel free to fork and adapt.

## Quick Start

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install sdd@sdd-misc-plugins
/plugin install codescout-companion@sdd-misc-plugins
```

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| **[sdd](./sdd/)** | 2.4.0 | Specification-Driven Development: governance, workflow commands, and enforcement hooks |
| **[codescout-companion](./codescout-companion/)** | 1.8.6 | Companion plugin for [codescout](https://github.com/mareurs/codescout) MCP server: injects tool guidance, redirects Read/Grep/Glob/Edit/Write to symbol-aware tools, GitHub context injection, auto-reindex + drift warnings, worktree shared-asset symlinking |

## Requirements

- [Claude Code](https://claude.com/claude-code) CLI
- [jq](https://jqlang.github.io/jq/) -- used by hook scripts for JSON parsing

### Per-plugin requirements

| Plugin | Additional Requirements |
|--------|----------------------|
| **sdd** | None (core workflow). [Serena MCP](https://github.com/oraios/serena) for `/drift` and `/document`. |
| **codescout-companion** | [codescout MCP](https://github.com/mareurs/codescout) server configured in `.mcp.json` or globally. |

## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

### codescout-companion

Companion plugin for [codescout](https://github.com/mareurs/codescout) MCP server. Routes Claude to use codescout's symbol-aware tools instead of Read/Grep/Glob. Auto-detects codescout from `.mcp.json`, `~/.claude/.claude.json`, or `~/.claude/settings.json`.

**Hooks:**
- **session-start** -- Tool guidance, memory hints, onboarding nudge, auto-reindex + drift warnings
- **subagent-guidance** -- Injects codescout guidance into all subagents (MCP server_instructions only reach the main agent)
- **post-tool-guidance** -- PostToolUse soft warnings when Read/Grep/Glob are used on source files, suggests codescout alternatives
- **worktree-activate** -- PostToolUse: creates write-guard marker + injects activate_project guidance after EnterWorktree
- **worktree-write-guard** -- PreToolUse: hard-blocks codescout write tools in worktrees until activate_project is called
- **ce-activate-project** -- PostToolUse: clears write-guard marker after activate_project fires

See [codescout-companion/README.md](./codescout-companion/) for details and configuration.

## Team Setup

Add to your project's `.claude/settings.json` so all team members get the plugins automatically:

```json
{
  "extraKnownMarketplaces": {
    "sdd-misc-plugins": {
      "source": {
        "source": "github",
        "repo": "mareurs/sdd-misc-plugins"
      }
    }
  },
  "enabledPlugins": {
    "sdd@sdd-misc-plugins": true,
    "codescout-companion@sdd-misc-plugins": true
  }
}
```

When team members trust the repository folder, Claude Code automatically installs the marketplace and plugins.

## License

MIT
