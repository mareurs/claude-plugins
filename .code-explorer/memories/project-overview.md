# Claude Plugins Marketplace

## Purpose
Personal Claude Code plugin marketplace (GitHub: mareurs/sdd-misc-plugins) containing 3 plugins for development workflows and tool routing. Public for team/collaborator install.

## Tech Stack
- **Language:** Bash (hooks), JSON (config)
- **Runtime:** Claude Code CLI plugin system
- **Key deps:** `jq` (JSON parsing in hooks), `sqlite3` (index staleness/drift), `git` (HEAD comparison)

## Plugins
| Plugin | Version | Status |
|--------|---------|--------|
| sdd | 2.2.1 | Active — Specification-Driven Development |
| code-explorer-routing | 1.2.1 | Active — companion for code-explorer MCP |
| tool-infra | 2.8.0 | Deprecated — superseded by code-explorer-routing |

## Runtime Requirements
- Claude Code CLI with plugin support
- `jq` on PATH
- For code-explorer-routing: code-explorer MCP server configured globally or in .mcp.json
