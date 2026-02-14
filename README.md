# Claude Plugins

An opinionated collection of Claude Code plugins, primarily developed for internal team use. Public so colleagues and collaborators can install directly.

These plugins reflect specific workflows and tool choices -- they may not suit every setup. Feel free to fork and adapt.

## Quick Start

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install sdd@sdd-misc-plugins
/plugin install tool-infra@sdd-misc-plugins
```

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| **[sdd](./sdd/)** | 2.1.0 | Specification-Driven Development: governance, workflow commands, and enforcement hooks |
| **[tool-infra](./tool-infra/)** | 2.4.0 | Semantic tool infrastructure: routes Claude to use Serena/IntelliJ/claude-context instead of Grep/Glob |

## Requirements

- [Claude Code](https://claude.com/claude-code) CLI
- [jq](https://jqlang.github.io/jq/) -- used by hook scripts for JSON parsing

### Per-plugin requirements

| Plugin | Additional Requirements |
|--------|----------------------|
| **sdd** | None (core workflow). [Serena MCP](https://github.com/oraios/serena) for `/drift` and `/document`. |
| **tool-infra** | [Serena MCP](https://github.com/oraios/serena), [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp), and/or [claude-context](https://github.com/nicobailon/claude-context). Auto-detects which are available. |

## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration), `tool-routing` (semantic code navigation)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

### tool-infra

Makes Claude use semantic code tools (Serena, IntelliJ MCP, claude-context) instead of falling back to text search. Auto-detects which tools are available from `.mcp.json` or `.claude/tool-infra.json`.

**Hooks:**
- **session-start** -- Tool reference card, query examples for claude-context, structure discovery for Serena
- **semantic-tool-router** -- Blocks Grep/Glob on source files, suggests semantic alternatives
- **mcp-param-fixer** -- Auto-corrects wrong MCP parameter names in-place (e.g. `pattern` -> `substring_pattern`)
- **explore-agent-guidance** -- Injects semantic tool workflow into Explore subagents
- **intellij-project-path** -- Auto-injects `project_path` into IntelliJ index calls

See [tool-infra/README.md](./tool-infra/) for details and configuration.

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
    "tool-infra@sdd-misc-plugins": true
  }
}
```

When team members trust the repository folder, Claude Code automatically installs the marketplace and plugins.

## License

MIT
