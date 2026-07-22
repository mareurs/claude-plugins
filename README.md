# Claude Plugins

An opinionated collection of Claude Code plugins, primarily developed for internal team use. Public so colleagues and collaborators can install directly.

These plugins reflect specific workflows and tool choices -- they may not suit every setup. Feel free to fork and adapt.

## Quick Start

```
/plugin marketplace add mareurs/claude-plugins
/plugin install sdd@claude-plugins
/plugin install codescout-companion@claude-plugins
/plugin install buddy@claude-plugins
```

## Available Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| **[sdd](./sdd/)** | 2.4.1 | Specification-Driven Development: governance, workflow commands, and enforcement hooks |
| **[codescout-companion](./codescout-companion/)** | 1.16.2 | Companion plugin for [codescout](https://github.com/mareurs/codescout) MCP server: injects tool guidance, redirects Read/Grep/Glob/Edit/Write to symbol-aware tools, auto-reindex + drift warnings, worktree shared-asset symlinking |
| **[claude-statusline](./claude-statusline/)** | 1.1.7 | Rich, color-coded terminal status line: model, context %, rate limits (incl. per-model weekly), git info, duration. Self-heals orphan `statusLine` settings when sibling plugins are uninstalled. |
| **[buddy](./buddy/)** | 0.9.1 | Himalayan-aesthetic bodhisattva companion: 12 specialist masters on demand, AI judge, focus tracking, statusline integration |
| **[pi companion](./pi/)** | 0.1.0 | Companion for [pi](https://github.com/earendil-works/pi-mono): skill-load tracker, recon badge, MCP status widget; codescout tools as first-class pi tools; all skills wired in |
| **[session-bridge](./session-bridge/)** | 0.1.0 | Cross-session MCP bridge: ask one Claude Code session a question from another, answered in its loaded context. Rust MCP server, bash SessionStart/Stop hooks. |
## Requirements

- [Claude Code](https://claude.com/claude-code) CLI
- [jq](https://jqlang.github.io/jq/) -- used by hook scripts for JSON parsing

### Per-plugin requirements

| Plugin | Additional Requirements |
|--------|----------------------|
| **sdd** | None (core workflow). [Serena MCP](https://github.com/oraios/serena) for `/drift` and `/document`. |
| **codescout-companion** | [codescout MCP](https://github.com/mareurs/codescout) server configured in `.mcp.json` or globally. |


## Pi

For [pi](https://github.com/earendil-works/pi-mono) users, this repo ships a companion in [`pi/`](./pi/).

**Full setup** involves three components that layer on top of each other:

1. **pi-mcp-adapter** (pi package) — connects MCP servers to pi
2. **claude-plugins/pi companion** — widget extension + skill dirs wired into pi
3. **codescout/contrib/pi** (from the codescout repo) — `codescout-mode.ts` extension + `AGENTS.md` + `mcp.json.example`

Quick install (claude-plugins part):

```bash
pi install npm:pi-mcp-adapter          # once — adds pi-mcp-adapter package
git clone https://github.com/mareurs/claude-plugins
cd claude-plugins/pi
./install.sh
```

Then configure `~/.pi/agent/mcp.json` with your codescout binary path and any API keys.
Run `/mcp reconnect codescout` once in pi to warm the directTools cache.

What you get:
- Widget below the editor: `cs: reconnaissance  [recon F2/W1]`, `skills: debugging-yeti, pdf …`, `MCP: 2/2  codescout ●  researcher ●`
- All skill directories (`codescout-companion/skills`, `buddy/skills`, `sdd/skills`) wired into pi — no duplication
- codescout tools (`symbols`, `read_file`, `edit_code`, …) available as first-class pi tools (not proxied)
- Research skills (`/skill:research-web`, `/skill:research-subagent`) ready with researcher-mcp

See [pi/README.md](./pi/README.md) for the full step-by-step install, `mcp.json` examples, extension details, and skill reference.


### Routing pi through a local LLM proxy

pi supports an Anthropic-Messages-compatible proxy for any provider via
`~/.pi/agent/models.json`. Two patterns worth knowing:

**Single upstream (Anthropic direct):**

```json
{
  "providers": {
    "anthropic": { "baseUrl": "http://localhost:8082" }
  }
}
```

**Multiple upstreams through one proxy (Anthropic + GitHub Copilot):** if your
proxy has a fixed upstream, use a per-request `X-Proxy-Upstream` header so the
proxy can route to the right backend. The header is stripped before forwarding.
GitHub Copilot models already speak the Anthropic Messages API, so the same
proxy serves both.

```json
{
  "providers": {
    "anthropic": { "baseUrl": "http://localhost:8082" },
    "github-copilot": {
      "baseUrl": "http://localhost:8082",
      "headers": { "X-Proxy-Upstream": "https://api.individual.githubcopilot.com" }
    }
  }
}
```

See [`docs/pi-integration.md`](./docs/pi-integration.md) for the full setup:
proxy implementation, local model providers, skill versioning, and the
`X-Proxy-Upstream` contract.
## Plugins

### SDD (Specification-Driven Development)

A methodology where code follows specifications. Every feature starts with a clear definition of *what* before diving into *how*.

**Commands:** `/specify`, `/plan`, `/review`, `/drift`, `/document`, `/bootstrap-docs`, `/sdd-init`

**Skills:** `sdd-flow` (full lifecycle orchestration)

**Hooks:** spec-guard, review-guard, subagent-inject, session-start

See [sdd/README.md](./sdd/) for full documentation.

### codescout-companion

Companion plugin for [codescout](https://github.com/mareurs/codescout) MCP server. Routes Claude to use codescout's symbol-aware tools instead of Read/Grep/Glob. Auto-detects codescout from `.mcp.json`, `~/.claude/.claude.json`, `~/.claude/settings.json`, or `~/.claude.json`.

**Hooks:**
- **session-start** -- Tool guidance, memory hints, onboarding nudge, auto-reindex + drift warnings
- **subagent-guidance** -- Injects codescout guidance into all subagents (MCP server_instructions only reach the main agent)
- **post-tool-guidance** -- PostToolUse soft warnings when Read/Grep/Glob are used on source files, suggests codescout alternatives
- **worktree-activate** -- PostToolUse: creates write-guard marker + injects activate_project guidance after EnterWorktree
- **worktree-write-guard** -- PreToolUse: hard-blocks codescout write tools in worktrees until activate_project is called
- **ce-activate-project** -- PostToolUse: clears write-guard marker after activate_project fires

See [codescout-companion/README.md](./codescout-companion/) for details and configuration.

### Pi companion

Companion for [pi](https://github.com/earendil-works/pi-mono). Two TypeScript extensions and an AGENTS.md routing guide integrate codescout as pi's primary code-intelligence layer.

**Extensions:**
- `codescout-companion.ts` (this repo) — widget below editor: skill-load tracker, recon badge, MCP server status
- `codescout-mode.ts` (codescout repo, `contrib/pi/`) — drops pi's native `edit`, activates codescout hot-set on session start, bash source-search nudge

**Skills wired into pi:** reconnaissance, explore-project, 12 buddy specialists, sdd-flow, researcher-mcp, research-web, research-subagent, tracker-hygiene

**MCP:** codescout tools surface as first-class pi tools via `directTools` (no `mcp__codescout__` prefix). researcher-mcp optional.

See [pi/README.md](./pi/README.md) for full install instructions.

## Team Setup

Add to your project's `.claude/settings.json` so all team members get the plugins automatically:

```json
{
  "extraKnownMarketplaces": {
    "claude-plugins": {
      "source": {
        "source": "github",
        "repo": "mareurs/claude-plugins"
      }
    }
  },
  "enabledPlugins": {
    "sdd@claude-plugins": true,
    "codescout-companion@claude-plugins": true,
    "buddy@claude-plugins": true
  }
}
```

When team members trust the repository folder, Claude Code automatically installs the marketplace and plugins.

## License

MIT
