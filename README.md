# Claude Plugins

An opinionated collection of Claude Code plugins, primarily developed for internal team use. Public so colleagues and collaborators can install directly.

These plugins reflect specific workflows and tool choices -- they may not suit every setup. Feel free to fork and adapt.

## Requirements

- [Claude Code](https://claude.com/claude-code) CLI
- [jq](https://jqlang.github.io/jq/) -- used by hook scripts for JSON parsing

### Per-plugin requirements

| Plugin | Additional Requirements |
|--------|----------------------|
| **sdd** | None (core workflow). [Serena MCP](https://github.com/oraios/serena) for `/drift` and `/document`. |
| **tool-infra** | [Serena MCP](https://github.com/oraios/serena) and/or [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp) depending on which hooks you need. |

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| **[sdd](./sdd/)** | 2.1.0 | Specification-Driven Development: governance, workflow commands, and enforcement hooks |
| **[tool-infra](./tool-infra/)** | 1.0.0 | Infrastructure hooks for Serena and IntelliJ MCP tools |

## Installation

### Add the marketplace

```
/plugin marketplace add mareurs/claude-plugins
```

### Install plugins

```
/plugin install sdd@claude-plugins
/plugin install tool-infra@claude-plugins
```

### Team setup

Add to your project's `.claude/settings.json` so all team members get the marketplace automatically:

```json
{
  "extraKnownMarketplaces": {
    "claude-plugins": {
      "source": {
        "source": "github",
        "repo": "mareurs/claude-plugins"
      }
    }
  }
}
```

When team members trust the repository folder, Claude Code automatically installs the marketplace and any plugins listed in `enabledPlugins`.

## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration), `tool-routing` (semantic code navigation)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

### tool-infra

Generic infrastructure hooks for MCP tool integrations. Zero configuration -- derives project context from `cwd`.

**Hooks:**
- **serena-activate-guard** -- Denies Serena tool calls until `activate_project()` is called. Prevents cryptic errors from unactivated projects.
- **intellij-project-path** -- Auto-injects `project_path` into IntelliJ index calls. Prevents "project_path required" errors.

See [tool-infra/README.md](./tool-infra/) for details.

## License

MIT
