#!/usr/bin/env bash
# claude-statusline SessionStart hook — self-heal orphan statusLine entries.
#
# Background: both buddy and claude-statusline can write a `statusLine` key
# into ~/.claude/settings.json. If the plugin that owns the referenced script
# is later uninstalled (without running its /uninstall command), the key
# becomes a dangling pointer and Claude Code prints a startup error.
#
# This hook detects two orphan patterns:
#   1. `${CLAUDE_PLUGIN_ROOT}/...` references where no currently-installed
#      plugin can resolve the path (i.e., the plugin was removed).
#   2. Absolute paths (~/... or /...) that no longer exist on disk.
#
# On orphan detection: prune the statusLine key atomically and emit one
# stderr line so the user knows. Never blocks; always exits 0.
#
# Quiet on the happy path — no output when the statusLine is healthy.

set -e

# Always read stdin (CC passes session metadata; we ignore it).
cat > /dev/null 2>&1 || true

python3 <<'PYEOF' 2>/dev/null || true
import json
import os
import pathlib
import re
import shlex
import sys
import tempfile

home = pathlib.Path.home()
settings_path = home / '.claude' / 'settings.json'
installed_path = home / '.claude' / 'plugins' / 'installed_plugins.json'

if not settings_path.exists():
    sys.exit(0)

try:
    raw = settings_path.read_text()
    settings = json.loads(raw) if raw.strip() else {}
except (OSError, json.JSONDecodeError):
    sys.exit(0)

if not isinstance(settings, dict):
    sys.exit(0)

sl = settings.get('statusLine')
if not isinstance(sl, dict):
    sys.exit(0)

cmd = sl.get('command', '') or ''
if not cmd.strip():
    sys.exit(0)

# Extract the script path from the command. Handle common shapes:
#   bash /path/to/script.sh [args]
#   python3 /path/to/script.py [args]
#   /direct/path/to/script
try:
    tokens = shlex.split(cmd, posix=True)
except ValueError:
    sys.exit(0)

if not tokens:
    sys.exit(0)

script = None
if tokens[0] in ('bash', 'sh', 'zsh', 'python', 'python3') and len(tokens) >= 2:
    script = tokens[1]
elif tokens[0].startswith(('/', '~', '$')):
    script = tokens[0]

if not script:
    sys.exit(0)

orphan = False
reason = ''

# Pattern 1: ${CLAUDE_PLUGIN_ROOT}/... — resolve against installed plugins
if '${CLAUDE_PLUGIN_ROOT}' in script or '$CLAUDE_PLUGIN_ROOT' in script:
    suffix = re.sub(r'\$\{?CLAUDE_PLUGIN_ROOT\}?', '', script)
    suffix = suffix.lstrip('/')

    resolved_any = False
    if installed_path.exists():
        try:
            installed = json.loads(installed_path.read_text())
            for plugin_key, records in (installed.get('plugins') or {}).items():
                if not isinstance(records, list):
                    continue
                for rec in records:
                    install_path = rec.get('installPath')
                    if not install_path:
                        continue
                    candidate = pathlib.Path(install_path) / suffix
                    if candidate.exists():
                        resolved_any = True
                        break
                if resolved_any:
                    break
        except (OSError, json.JSONDecodeError):
            # installed_plugins.json unreadable — be conservative, do not prune
            sys.exit(0)

    if not resolved_any:
        orphan = True
        reason = f'no installed plugin provides {script!r}'

# Pattern 2: absolute path that does not exist
else:
    expanded = pathlib.Path(os.path.expandvars(os.path.expanduser(script)))
    if expanded.is_absolute() and not expanded.exists():
        orphan = True
        reason = f'{expanded} not found'

if not orphan:
    sys.exit(0)

# Atomic prune
removed = settings.pop('statusLine', None)
content = json.dumps(settings, indent=2) + '\n'
fd, tmp = tempfile.mkstemp(dir=str(settings_path.parent), prefix='.settings_tmp_')
try:
    with os.fdopen(fd, 'w') as f:
        f.write(content)
    os.replace(tmp, settings_path)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    sys.exit(0)

print(
    f'[claude-statusline] Pruned orphan statusLine entry ({reason}). '
    f'Removed: {json.dumps(removed)}',
    file=sys.stderr,
)
PYEOF

exit 0
