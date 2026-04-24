#!/usr/bin/env bash
# Set up buddy plugin in dev mode: symlink cache dirs to this repo.
# Idempotent — safe to re-run at any time.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE="sdd-misc-plugins"
PLUGIN="buddy"
VERSION="0.1.0"
PLUGIN_KEY="buddy@sdd-misc-plugins"

failures=0

for config_dir in "$HOME/.claude" "$HOME/.claude-sdd"; do
    instance="$(basename "$config_dir")"
    cache_parent="$config_dir/plugins/cache/$MARKETPLACE/$PLUGIN"
    cache_dir="$cache_parent/$VERSION"
    plugins_json="$config_dir/plugins/installed_plugins.json"

    echo "── ~/$instance ──"

    # 1. Ensure buddy is registered in installed_plugins.json
    if [ -f "$plugins_json" ]; then
        if python3 -c "
import json, sys
with open('$plugins_json') as f:
    data = json.load(f)
if '$PLUGIN_KEY' not in data.get('plugins', {}):
    sys.exit(1)
" 2>/dev/null; then
            echo "  ✓ registered in installed_plugins.json"
        else
            echo "  + registering in installed_plugins.json"
            python3 -c "
import json, tempfile, os
from datetime import datetime, timezone
plugins_json = '$plugins_json'
with open(plugins_json) as f:
    data = json.load(f)
data.setdefault('plugins', {})['$PLUGIN_KEY'] = [{
    'scope': 'user',
    'installPath': '$cache_dir',
    'version': '$VERSION',
    'installedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
    'lastUpdated': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
}]
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(plugins_json))
with os.fdopen(fd, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
os.replace(tmp, plugins_json)
"
        fi
    else
        echo "  ⚠ $plugins_json not found — install buddy via /plugin first, then re-run"
        ((failures++))
        continue
    fi

    # 2. Replace cache dir with symlink
    if [ -L "$cache_dir" ]; then
        target="$(readlink -f "$cache_dir")"
        if [ "$target" = "$PLUGIN_ROOT" ]; then
            echo "  ✓ symlink already correct"
            continue
        else
            echo "  ~ removing stale symlink → $target"
            rm "$cache_dir"
        fi
    elif [ -d "$cache_dir" ]; then
        echo "  ~ removing cache copy"
        rm -rf "$cache_dir"
    fi

    mkdir -p "$cache_parent"
    ln -s "$PLUGIN_ROOT" "$cache_dir"
    echo "  ✓ symlinked → $PLUGIN_ROOT"
done

echo ""
echo "Done. Run /reload-plugins in Claude Code to pick up changes."

# Verify with dev-check
echo ""
bash "$PLUGIN_ROOT/scripts/dev-check.sh"
