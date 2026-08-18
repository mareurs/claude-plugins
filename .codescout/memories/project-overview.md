# Claude Plugins

## Purpose
A Claude Code plugin marketplace hosting two plugins for internal/team use: `codescout-companion` (tool routing + codescout MCP companion) and `sdd` (Specification-Driven Development governance). Distributed via GitHub as a marketplace source.

## Tech Stack
- **Language:** Bash (hooks), Markdown (commands/skills/docs)
- **Dependencies:** `jq` (JSON parsing in all hooks), `sqlite3` (staleness/drift queries in session-start), `git` (worktree detection, commit comparison), `gh` (GitHub identity injection)
- **Plugin runtime:** Claude Code plugin system — hooks triggered by Claude Code events

## Runtime Requirements
- Claude Code CLI
- `jq` — required for all hooks
- `sqlite3` — required for auto-reindex + drift warnings (codescout-companion)
- `git` — required for worktree detection
- `codescout` MCP server configured (for codescout-companion to activate)

## Repo Identity
- GitHub: `mareurs/claude-plugins` (previously `mareurs/sdd-misc-plugins` — old name still appears in some docs)
- Marketplace ID in older docs: `sdd-misc-plugins`; current README uses `claude-plugins`
