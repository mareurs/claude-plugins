You are uninstalling the buddy statusline integration from the user's Claude Code settings.

This removes the `statusLine` entry from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json` only if it currently points at buddy. Other keys in settings.json are preserved. The plugin itself is NOT removed — run `/plugin uninstall buddy@<marketplace>` separately for that.

## Step 1 — Inspect the current statusLine

```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" python3 -c "
import json, os, pathlib
p = pathlib.Path(os.environ['SETTINGS'])
if not p.exists():
    print('NO_SETTINGS')
    raise SystemExit(0)
raw = p.read_text()
try:
    s = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print('ERROR: settings.json is not valid JSON')
    raise SystemExit(1)
sl = (s or {}).get('statusLine')
if not isinstance(sl, dict):
    print('NO_STATUSLINE')
    raise SystemExit(0)
cmd = sl.get('command', '') or ''
print('CURRENT:', cmd)
"
```
## Step 2 — Decide whether to prune

Inspect the printed `CURRENT:` command. It belongs to buddy if it contains any of these markers:

- `${CLAUDE_PLUGIN_ROOT}/scripts/statusline-composed.sh`
- `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`
- A literal absolute path containing `/buddy/.../scripts/statusline-composed.sh` or `/buddy/.../scripts/statusline.py`

If the command does NOT match any of these markers, STOP. Report: "statusLine is set by a different tool — not removing it." Do not modify the file.

If `NO_SETTINGS` or `NO_STATUSLINE` was printed, STOP. Report: "Nothing to remove." Do not modify the file.

## Step 3 — Confirm with the user

Print the current command and ask:

> "Remove buddy statusLine entry `<current command>` from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`? Reply yes to remove, no to cancel."

If anything other than a clear yes, STOP and report cancelled.
## Step 4 — Atomic prune

```bash
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" python3 -c "
import json, os, pathlib, tempfile
p = pathlib.Path(os.environ['SETTINGS'])
raw = p.read_text() if p.exists() else '{}'
try:
    s = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print('ERROR: settings.json is not valid JSON. Aborting.')
    raise SystemExit(1)
if not isinstance(s, dict):
    print('ERROR: settings.json top-level value is not an object. Aborting.')
    raise SystemExit(1)
removed = s.pop('statusLine', None)
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
print('Removed statusLine:', json.dumps(removed))
"
```
## Step 5 — Report

Print:

- Confirmation that the `statusLine` key was removed
- A note that the buddy plugin itself is still installed; run `/plugin uninstall buddy@<marketplace>` if you want to remove the plugin entirely
- A note that the user should restart Claude Code for the statusline change to take effect
