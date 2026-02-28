# Development Commands

## Validation
`scripts/check-versions.sh` — verifies plugin.json versions match README table, marketplace.json has no versions

## Testing Hooks
```bash
echo '{"cwd":"/path/to/project"}' | bash code-explorer-routing/hooks/session-start.sh
echo '{"tool_name":"Read","cwd":"/path","tool_input":{"file_path":"/path/foo.ts"}}' | bash code-explorer-routing/hooks/post-tool-guidance.sh
```

## Before Completing Work
1. Run `scripts/check-versions.sh` — must show "All versions consistent"
2. Verify no ToolSearch or stale tool names in guidance.txt
3. Verify hooks.json matches actual hook scripts in directory
4. `git diff` to review all changes
