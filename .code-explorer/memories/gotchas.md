# Gotchas & Known Issues

## Version Drift
- **Problem:** marketplace.json previously had version fields causing drift with plugin.json
  **Fix:** marketplace.json must NEVER have version fields. check-versions.sh enforces this.

## Orphaned Cache Versions
- **Problem:** Old versions linger in ~/.claude/plugins/cache/ with .orphaned_at files but may still confuse debugging
  **Fix:** Manually delete orphaned cache dirs when investigating plugin issues

## installed_plugins.json Stale Version
- **Problem:** When plugin is installed from local dev dir, installed_plugins.json version can get stale if you edit plugin.json directly
  **Fix:** Update installed_plugins.json manually or reinstall plugin

## Hooks Can't Verify MCP Connectivity
- **Problem:** detect-tools.sh checks config files exist but can't verify MCP server actually connected
  **Fix:** guidance.txt includes FALLBACK line; session-start.sh emits connectivity caveat

## guidance.txt vs server_instructions.md Desync
- **Problem:** Tool names or rules diverge between the two files
  **Fix:** After any guidance change, compare both files. guidance.txt is compact subset of server_instructions.md.

## ToolSearch (Historical)
- **Problem:** guidance.txt previously referenced non-existent ToolSearch tool, confusing agents
  **Fix:** Removed in 1.2.1. MCP tools auto-load when server connects — no manual step.
