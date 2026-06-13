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

for config_dir in "$HOME/.claude" "$HOME/.claude-sdd" "$HOME/.claude-kat"; do
    instance="$(basename "$config_dir")"
    cache_parent="$config_dir/plugins/cache/$MARKETPLACE/$PLUGIN"
    cache_dir="$cache_parent/$VERSION"
    plugins_json="$config_dir/plugins/installed_plugins.json"

    echo "── ~/$instance ──"

    # 1. Ensure buddy's install record points at the dev symlink (0.1.0).
    #    Registers if missing; REPAIRS installPath/version if a version bump
    #    clobbered them to a versioned cache copy. That clobber is the drift
    #    that silently freezes dev mode at a stale snapshot on the next cold
    #    restart — repairing it here is what keeps re-running idempotent.
    if [ -f "$plugins_json" ]; then
        python3 -c "
import json, tempfile, os
from datetime import datetime, timezone
pj = '$plugins_json'
with open(pj) as f:
    data = json.load(f)
plugins = data.setdefault('plugins', {})
now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
entry = plugins.get('$PLUGIN_KEY')
if not entry:
    plugins['$PLUGIN_KEY'] = [{
        'scope': 'user', 'installPath': '$cache_dir', 'version': '$VERSION',
        'installedAt': now, 'lastUpdated': now,
    }]
    print('  + registered in installed_plugins.json (dev)')
else:
    e = entry[0]
    if e.get('installPath') != '$cache_dir' or e.get('version') != '$VERSION':
        print('  ~ repairing record -> dev symlink (was %s @ %s)' % (e.get('version'), e.get('installPath')))
        e['installPath'] = '$cache_dir'
        e['version'] = '$VERSION'
        e['lastUpdated'] = now
    else:
        print('  ✓ record already points at dev symlink')
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(pj))
with os.fdopen(fd, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
os.replace(tmp, pj)
"
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
