# Conventions

## Version Management
- Single source of truth: `<plugin>/.claude-plugin/plugin.json`
- marketplace.json must NEVER contain version fields (causes drift — already burned us)
- When bumping: update plugin.json → update README table → run check-versions.sh → commit

## Hook Scripts
- All hooks read JSON from stdin via `INPUT=$(cat)`
- Parse with `jq`: `CWD=$(echo "$INPUT" | jq -r '.cwd // empty')`
- Use `${CLAUDE_PLUGIN_ROOT}` for relative file references within plugin
- Shared logic goes in detect-tools.sh, sourced by other scripts
- Output via `jq -n` to build proper JSON responses

## Guidance Sync Requirement
MCP server_instructions only reach main agent. guidance.txt reaches subagents via SubagentStart hook.
Both MUST have same tool names and consistent rules. guidance.txt is compact subset.

## Commit Messages
Pattern: `fix(routing):`, `feat(routing):`, `docs:`, `chore: bump <plugin> to <version>`

## Testing Hooks Locally
```bash
echo '{"cwd":"/some/path"}' | bash code-explorer-routing/hooks/session-start.sh
```
