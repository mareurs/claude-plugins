You are installing the buddy statusline into the user's Claude Code settings.

## Step 1 — Detect sibling plugins

Use the `Bash` tool to detect whether the `claude-statusline` plugin is installed alongside buddy. The plugin root for buddy is `${CLAUDE_PLUGIN_ROOT}`; claude-statusline (if present) lives at `~/.claude/plugins/claude-statusline/`.

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/buddy}"
if [ -d "$HOME/.claude/plugins/claude-statusline" ]; then
  echo "MODE=composed"
else
  echo "MODE=standalone"
fi
echo "PLUGIN_ROOT=$PLUGIN_ROOT"
```

Capture the `MODE` value from the output.
## Step 2 — Choose the statusLine command

Based on MODE:

- **composed:** `bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-composed.sh`
- **standalone:** `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`

Keep `${CLAUDE_PLUGIN_ROOT}` as a literal string in the written settings — Claude Code expands it at statusline execution time.

Note: `${CLAUDE_PLUGIN_ROOT}` stays as a literal in the written string; Claude Code expands it when the statusline runs. The `PLUGIN_ROOT` resolved in Step 1 is only used for the in-command logic (for future steps that might need to read plugin files during install).
## Step 3 — Inspect the current settings.json

```bash
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
python3 -c "
import json, pathlib
p = pathlib.Path.home() / '.claude' / 'settings.json'
raw = p.read_text() if p.exists() else '{}'
try:
    s = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print('ERROR: settings.json is not valid JSON')
    raise SystemExit(1)
if not isinstance(s, dict):
    print('ERROR: settings.json top-level is not an object')
    raise SystemExit(1)
if 'statusLine' in s:
    print('EXISTING:', json.dumps(s['statusLine']))
else:
    print('EXISTING: NONE')
"
```
## Step 4 — If a statusLine already exists, confirm before overwriting

If the Step 3 output is `EXISTING: NONE`, proceed directly to Step 5.

Otherwise, print the current `statusLine` value and the proposed new command to the user, then ask:

> "You already have a `statusLine` entry: `<current>`. Overwrite it with the buddy statusline (`<new command>`)? Reply yes to overwrite, no to cancel."

If the user replies no (or anything other than a clear yes), STOP. Do not modify the file. Report that install was cancelled.

## Step 5 — Write the new statusLine entry

Use the `Bash` tool. Substitute `<CHOSEN_COMMAND>` with the command chosen in Step 2 (keep the literal `${CLAUDE_PLUGIN_ROOT}` inside it).

```bash
python3 -c "
import json, pathlib, tempfile, os
p = pathlib.Path.home() / '.claude' / 'settings.json'
raw = p.read_text() if p.exists() else '{}'
try:
    s = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print('ERROR: ~/.claude/settings.json is not valid JSON. Aborting install.')
    raise SystemExit(1)
if not isinstance(s, dict):
    print('ERROR: ~/.claude/settings.json top-level value is not an object. Aborting install.')
    raise SystemExit(1)
s['statusLine'] = {
    'type': 'command',
    'command': '<CHOSEN_COMMAND>'
}
content = json.dumps(s, indent=2) + '\n'
fd, tmp_path = tempfile.mkstemp(dir=str(p.parent), prefix='.settings_tmp_')
try:
    with os.fdopen(fd, 'w') as f:
        f.write(content)
    os.replace(tmp_path, p)
except Exception:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    raise
print('Wrote statusLine:', s['statusLine']['command'])
"
```
## Step 6 — Report

Print a short summary:

- Which mode was chosen (composed or standalone) and why
- The exact command string written to `~/.claude/settings.json`
- Tell the user to restart Claude Code (or run `/reload-plugins` if available) for the statusline to take effect
- Suggest next steps: `/buddy:legend` for the reference card, `/buddy:status` for diagnostics

## Step 7 — Do not log

Install is not a summon event. Skip the `summons.log` append.
