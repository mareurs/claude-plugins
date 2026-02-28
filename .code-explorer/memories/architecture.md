# Architecture

## Structure
Each plugin is a self-contained directory with:
- `.claude-plugin/plugin.json` — metadata + version (source of truth)
- `hooks/hooks.json` — hook registration (event → script mapping)
- `hooks/*.sh` — bash hook scripts
- Optional: `commands/`, `skills/` (sdd only)

Root level:
- `.claude-plugin/marketplace.json` — catalog (NO version fields!)
- `scripts/check-versions.sh` — validates version consistency

## Hook Event Flow
```
SessionStart → session-start.sh → injects system-prompt.md + project state into main agent
SubagentStart → subagent-guidance.sh → injects system-prompt.md into code-working subagents
PostToolUse → post-tool-guidance.sh → soft warnings for Read/Grep/Glob on source
PostToolUse(EnterWorktree) → worktree-activate.sh → re-activates project
```

## Key Design Fact: server_instructions reach ALL agents
MCP `server_instructions` are re-sent per subagent (each spawns its own MCP session).
Generic tool routing guidance is therefore already covered by code-explorer's server_instructions.md.
The plugin only injects dynamic, project-specific content that server_instructions cannot carry.

## Key Abstractions
- `detect-tools.sh` — shared detection logic, sourced by other hooks. Scans 4 config locations
  for code-explorer. Sets HAS_CODE_EXPLORER, CE_SERVER_NAME, CE_PREFIX, CE_BINARY,
  HAS_CE_SYSTEM_PROMPT, CE_SYSTEM_PROMPT, HAS_CE_ONBOARDING, HAS_CE_MEMORIES, CE_MEMORY_NAMES.
- `hooks.json` — declarative hook registration per Claude Code plugin spec

## Data Flow (code-explorer-routing)
1. SessionStart fires → session-start.sh sources detect-tools.sh
2. detect-tools.sh scans: routing config → .mcp.json → .claude.json → settings.json
3. If found: checks onboarding state, memory state, system-prompt.md, index staleness, drift
4. Emits additionalContext JSON with system-prompt content + project state warnings
5. On tool use: PostToolUse checks if Read/Grep/Glob targets source files → warns
