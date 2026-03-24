# /setup-statusline

Copies the claude-statusline script to `~/.claude/statusline.sh` and configures `settings.json`.

Run this after first install and after plugin updates.

## Steps

1. **Find the plugin install path.** Read `~/.claude/plugins/installed_plugins.json`. Find the entry for `claude-statusline@sdd-misc-plugins`. Extract the `installPath` value. If not found, tell the user the plugin is not installed and stop.

2. **Copy the script.** Check if `~/.claude/statusline.sh` already exists. If it does, show the user the version stamp (line 2 of the existing file) and ask if they want to overwrite. If they decline, stop. Copy `<installPath>/bin/statusline.sh` to `~/.claude/statusline.sh` and run `chmod +x ~/.claude/statusline.sh`.

3. **Configure settings.json.** Read `~/.claude/settings.json`. If it does not contain a `statusLine` key, add:
   ```json
   "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
   ```
   Write the file back. Do NOT remove or modify any other keys.

4. **Done.** Tell the user: "Status line installed. Restart Claude Code to activate it."
