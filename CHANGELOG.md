# Changelog

All notable changes to claude-plugins are documented here, organized by plugin.
Dates are release dates. Versions follow [Semantic Versioning](https://semver.org/).

---

## code-explorer-routing

Companion plugin for the [code-explorer](https://github.com/mareurs/code-explorer) MCP server.

### [1.2.3] — 2026-02-28

- Intercept `sed -i` on source files via PostToolUse on the Bash tool
- Warns and suggests `edit_lines`, `replace_symbol`, `insert_code`, or `rename_symbol`
- Handles all in-place variants: `sed -i`, `sed -i.bak`, `sed -i ''` (macOS), `find ... -exec sed -i`
- Non-source files (`.sh`, `.json`, `.md`) and piped sed pass through silently

### [1.2.2] — 2026-02-28

- Add `goto_definition` and `hover` to FIND guidance (new LSP navigation tools in code-explorer)
- Fix EDIT guidance: `insert_before_symbol` / `insert_after_symbol` → `insert_code(position=before/after)`
- Syncs guidance.txt with code-explorer's updated server_instructions.md

### [1.2.1] — 2026-02-27

- Remove ToolSearch references (tool removed from Claude Code)
- Add graceful degradation: hint to fall back to Read/Grep/Glob if MCP fails to connect
- Auto-reindex runs in the background — no longer blocks session start
- Auto-reindex: detects how many commits behind HEAD and reports it
- Drift warnings at session start: surfaces high-drift files from `drift_report` table
- Cross-repo exploration guidance injected into subagents (absolute paths + activate_project pattern)

### [1.1.0] — 2026-02-26

- PostToolUse soft-block: warns when Read/Grep/Glob target source files, suggests symbol-tool alternatives
- Worktree support: detects git worktrees in SessionStart, skips auto-index inside worktrees
- PostToolUse `worktree-activate` hook: re-activates code-explorer project when entering a worktree
- Single-source guidance: `guidance.txt` is the canonical text injected by both SessionStart and SubagentStart
- Workspace scoping: PostToolUse warnings only fire for files inside the active workspace root
- Tool name sync: updated to match code-explorer API renames (list_symbols, find_references, etc.)
- Improved deny messages; `.sh` files unblocked from source-file warnings

### [0.1.1] — 2026-02-26

- Fix detect-tools.sh quality issues
- Strengthen guidance injection; improve MCP config detection reliability

### [0.1.0] — 2026-02-26

Initial release. Supersedes tool-infra for projects using code-explorer.

- `detect-tools.sh`: scans 4 config locations for code-explorer (routing config, .mcp.json, .claude.json, settings.json)
- SessionStart hook: injects tool guidance + onboarding/memory hints into main agent
- SubagentStart hook: injects same guidance into all spawned subagents
- PostToolUse hook: blocks Read/Grep/Glob on source files, redirects to symbol tools

---

## sdd

Specification-Driven Development: governance, workflow commands, and enforcement hooks.

### [2.2.1] — 2026-02-22

- Remove dead episodic-memory agent cases from subagent hook
- Align Explore agent spec filter to `.md` files only

### [2.2.0] — 2026-02-22

- Inject SDD context into Plan, general-purpose, and code-reviewer subagents (previously Explore only)
- Active spec listing in SessionStart: shows in-progress specs at session open
- Fire SubagentStart for all agent types, not just Explore

### [2.1.0] — 2026-02-08

Initial release.

- Specification-Driven Development workflow: spec → plan → implement → review lifecycle
- Constitutional governance hooks
- SDD commands and skills

---

## tool-infra *(deprecated)*

> **Deprecated as of 2026-02-26.** Superseded by [code-explorer-routing](#code-explorer-routing).
> tool-infra will be decommissioned in a future release. New projects should use code-explorer-routing.

### [2.8.0] — 2026-02-23 *(final release)*

- Serena JetBrains backend support: correct tool names and capabilities for the IntelliJ-backed Serena variant
- `ide_find_symbol` bridge pattern for Kotlin/Java symbol lookup

### [2.7.1] — 2026-02-22

- Kotlin/Java blocked-tool messages now guide toward `ide_find_symbol` bridge
- Warn against using Bash agents for code work
- Revert agent-type selection guidance (proved confusing in practice)

### [2.7.0] — 2026-02-21

- Language-aware routing for Plan agents
- claude-context integration: routes semantic queries to the self-hosted search MCP

### [2.6.0] — 2026-02-21

- Dual-tool mode: routes to both Serena and IntelliJ tools based on language context

### [2.5.1] — 2026-02-16

- Inject guidance into ALL subagent types (previously Explore only)
- Language-aware routing: different tool recommendations per language
- Read interception: blocks raw Read calls on source files

### [2.4.0] — 2026-02-13

- mcp-param-fixer overhaul: auto-corrects malformed MCP parameters instead of deny-and-retry
- `find_symbol` name_path and include_body parameter fixes

### [2.2.0] — 2026-02-10

- Auto-detect MCP servers from `.mcp.json` and `.claude/tool-infra.json`
- Session-start hook with tool reminder and schema pre-loading
