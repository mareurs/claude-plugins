# /uninstall-statusline

Removes the claude-statusline integration: prunes the `statusLine` entry from `~/.claude/settings.json` and optionally deletes `~/.claude/statusline.sh`.

Other keys in settings.json are preserved. The plugin itself is NOT removed — run `/plugin uninstall claude-statusline@<marketplace>` separately for that.

## Steps

1. **Inspect the current statusLine.** Read `~/.claude/settings.json`. If it has no `statusLine` key, tell the user "Nothing to remove" and stop. Otherwise print the current `statusLine.command`.

2. **Decide whether to prune.** The command belongs to claude-statusline if it references `~/.claude/statusline.sh` (literally or after `~` expansion). If the command points elsewhere (e.g., a buddy script), STOP. Report: "statusLine is set by a different tool — not removing it."

3. **Confirm with the user.** Ask: "Remove statusLine entry `<current command>` from `~/.claude/settings.json`? Reply yes to remove, no to cancel." If anything other than a clear yes, STOP.

4. **Atomic prune of `statusLine`.** Read settings.json → drop the `statusLine` key → write back atomically (temp file + `os.replace`). Do NOT remove or modify any other key.

5. **Ask about the script.** If `~/.claude/statusline.sh` exists, ask: "Also delete `~/.claude/statusline.sh`? Reply yes to delete." If yes, `rm ~/.claude/statusline.sh`. If no, leave it (user may want to keep their custom copy).

6. **Done.** Tell the user: "statusline integration removed. Restart Claude Code to clear the status bar." Note that the plugin itself is still installed; run `/plugin uninstall claude-statusline@<marketplace>` to remove it entirely.
