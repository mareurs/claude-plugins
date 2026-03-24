# claude-statusline

Rich, color-coded terminal status line for Claude Code.

## What It Shows

| Field | Description |
|-------|-------------|
| Model | Current model name (purple badge) |
| Agent | Subagent name when active (blue badge) |
| Context % | Context window usage (green → yellow → orange → red) |
| Rate limits | 5-hour and 7-day usage percentages |
| Git | Branch name, or worktree name + branch |
| Lines | Lines added (green) / removed (red) |
| Cache | Cache creation / read tokens in `k` units |
| Cost | Session total in USD |
| Duration | Elapsed time |

## Requirements

- `jq` — required (parses the JSON input from Claude Code)
- `git` — optional (branch name fallback)

## Installation

1. Install the plugin:
   ```
   /plugin install claude-statusline@claude-plugins
   ```
2. Run the setup command:
   ```
   /setup-statusline
   ```
3. Restart Claude Code.

## Updating

After plugin updates, run `/setup-statusline` again to refresh the script at `~/.claude/statusline.sh`.

## License

MIT
