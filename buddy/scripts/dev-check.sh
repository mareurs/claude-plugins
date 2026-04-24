#!/usr/bin/env bash
# Verify buddy dev-mode symlinks are intact in all Claude Code instances.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE="sdd-misc-plugins"
PLUGIN="buddy"
VERSION="0.1.0"

exit_code=0
installed_count=0

for config_dir in "$HOME/.claude" "$HOME/.claude-sdd"; do
    cache_dir="$config_dir/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION"
    instance="$(basename "$config_dir")"

    if [ ! -e "$cache_dir" ]; then
        echo "- ~/$instance: buddy not installed (skip)"
        continue
    fi

    installed_count=$((installed_count + 1))

    if [ -L "$cache_dir" ]; then
        target="$(readlink -f "$cache_dir")"
        if [ "$target" = "$PLUGIN_ROOT" ]; then
            echo "✓ ~/$instance: dev symlink OK → $target"
        else
            echo "✗ ~/$instance: symlink points to $target (expected $PLUGIN_ROOT)"
            exit_code=1
        fi
    else
        echo "✗ ~/$instance: cache is a copy, not a symlink — run: bash $PLUGIN_ROOT/scripts/dev-install.sh"
        exit_code=1
    fi
done

if [ "$installed_count" -eq 0 ]; then
    echo "✗ buddy not found in any Claude Code instance — run: bash $PLUGIN_ROOT/scripts/dev-install.sh"
    exit 1
fi

exit $exit_code
