# Claude Plugins

An opinionated collection of Claude Code plugins, primarily developed for internal team use. Public so colleagues and collaborators can install directly.

These plugins reflect specific workflows and tool choices -- they may not suit every setup. Feel free to fork and adapt.

## Quick Start

```
/plugin marketplace add mareurs/sdd-misc-plugins
/plugin install sdd@sdd-misc-plugins
/plugin install code-explorer-routing@sdd-misc-plugins
```

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| **[sdd](./sdd/)** | 2.2.1 | Specification-Driven Development: governance, workflow commands, and enforcement hooks |
| **[tool-infra](./tool-infra/)** | 2.8.0 | **Deprecated -- superseded by code-explorer-routing.** Semantic tool infrastructure: routes Claude to use Serena/IntelliJ/claude-context instead of Grep/Glob, with language-aware dual-tool routing |
| **[code-explorer-routing](./code-explorer-routing/)** | 1.3.0 | Companion plugin for [code-explorer](https://github.com/mareurs/code-explorer) MCP server: injects tool guidance, redirects Read/Grep/Glob to symbol-aware tools, auto-reindex + drift warnings. **Supersedes tool-infra.** |

## Requirements

- [Claude Code](https://claude.com/claude-code) CLI
- [jq](https://jqlang.github.io/jq/) -- used by hook scripts for JSON parsing

### Per-plugin requirements

| Plugin | Additional Requirements |
|--------|----------------------|
| **sdd** | None (core workflow). [Serena MCP](https://github.com/oraios/serena) for `/drift` and `/document`. |
| **tool-infra** | [Serena MCP](https://github.com/oraios/serena), [IntelliJ MCP](https://github.com/niclas-timm/intellij-index-mcp), and/or [claude-context](https://github.com/nicobailon/claude-context). Auto-detects which are available. |
| **code-explorer-routing** | [code-explorer MCP](https://github.com/mareurs/code-explorer) server configured in `.mcp.json` or globally. |

## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

### tool-infra (deprecated)

> **Deprecated:** Superseded by [code-explorer-routing](#code-explorer-routing). tool-infra will be decommissioned in a future release. New projects should use code-explorer-routing with [code-explorer](https://github.com/mareurs/code-explorer).

Makes Claude use semantic code tools (Serena, IntelliJ MCP, claude-context) instead of falling back to text search. Auto-detects tools from `.mcp.json` and languages from `.serena/project.yml` for language-aware routing.

**Hooks:**
- **session-start** -- Tool reference card with known issues, dual-tool decision matrix, and workflow patterns
- **subagent-guidance** -- Semantic tool workflow for all subagents; enriched guidance for Plan agents (workflow patterns, tool reference, known issues)
- **semantic-tool-router** -- Blocks Grep/Glob/Read on source files, suggests semantic alternatives
- **mcp-param-fixer** -- Auto-corrects wrong MCP parameter names in-place (e.g. `pattern` -> `substring_pattern`)
- **intellij-project-path** -- Auto-injects `project_path` into IntelliJ index calls
- **dual-tool-router** -- Language-aware blocking of broken Serena calls (Kotlin/Java), redirects to IntelliJ equivalents

See [tool-infra/README.md](./tool-infra/) for details and configuration.

### code-explorer-routing

Companion plugin for [code-explorer](https://github.com/mareurs/code-explorer) MCP server. Supersedes [tool-infra](#tool-infra-deprecated). Routes Claude to use code-explorer's symbol-aware tools instead of Read/Grep/Glob. Auto-detects code-explorer from `.mcp.json`, `~/.claude/.claude.json`, or `~/.claude/settings.json`.

**Hooks:**
- **session-start** -- Tool guidance, memory hints, onboarding nudge, auto-reindex + drift warnings
- **subagent-guidance** -- Injects code-explorer guidance into all subagents (MCP server_instructions only reach the main agent)
- **post-tool-guidance** -- PostToolUse soft warnings when Read/Grep/Glob are used on source files, suggests code-explorer alternatives
- **worktree-activate** -- Re-activates code-explorer project after EnterWorktree

See [code-explorer-routing/README.md](./code-explorer-routing/) for details and configuration.

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
    "code-explorer-routing@sdd-misc-plugins": true
  }
}
```

When team members trust the repository folder, Claude Code automatically installs the marketplace and plugins.

## License

MIT
