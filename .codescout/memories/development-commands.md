# Development Commands

## Testing

```bash
# Root plugin (bash tests)
./tests/run-all.sh

# buddy plugin (Python tests)
cd buddy && pytest

# Version consistency check (before any bump)
./scripts/check-versions.sh
```

## Manual Hook Testing

```bash
# Test a hook directly by piping JSON event
echo '{"cwd":"/some/path"}' | bash codescout-companion/hooks/session-start.sh
echo '{"tool_name":"Read","tool_input":{"file_path":"/src/foo.rs"}}' | bash codescout-companion/hooks/pre-tool-guard.sh
```

## Installing Plugins

```
/plugin marketplace add mareurs/claude-plugins
/plugin install codescout-companion@claude-plugins
/plugin install sdd@claude-plugins
```

## Version Bump (after tests pass)

1. Edit `<plugin>/.claude-plugin/plugin.json`
2. Edit version table in `README.md`
3. Run `./scripts/check-versions.sh`
4. `git commit -m "chore: bump <plugin> to <version>"`
5. Update `installPath` + `version` in all 3 `installed_plugins.json` files
6. Push + restart both Claude Code instances
