# Claude Plugins

A public marketplace of Claude Code plugins.

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

### Install a plugin

```
/plugin install sdd@claude-plugins
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

## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration), `tool-routing` (semantic code navigation)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

## License

MIT
