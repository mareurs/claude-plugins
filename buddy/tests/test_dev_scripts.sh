#!/usr/bin/env bash
# End-to-end test for dev-install.sh and dev-check.sh using a temp dir.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== Test: dev-check detects missing install ==="
# Create fake config dirs with no buddy cache
mkdir -p "$TMPDIR/.claude/plugins" "$TMPDIR/.claude-sdd/plugins"

# Override HOME so scripts target our temp dirs
export HOME="$TMPDIR"

bash "$PLUGIN_ROOT/scripts/dev-check.sh" && { echo "FAIL: expected exit 1"; exit 1; } || true
echo "PASS: dev-check correctly reports not installed"

echo ""
echo "=== Test: dev-install creates symlinks ==="

# Create minimal installed_plugins.json for both instances
for dir in "$TMPDIR/.claude" "$TMPDIR/.claude-sdd"; do
    mkdir -p "$dir/plugins"
    echo '{"version": 2, "plugins": {}}' > "$dir/plugins/installed_plugins.json"
done

bash "$PLUGIN_ROOT/scripts/dev-install.sh"

# Verify symlinks exist
for dir in "$TMPDIR/.claude" "$TMPDIR/.claude-sdd"; do
    cache="$dir/plugins/cache/sdd-misc-plugins/buddy/0.1.0"
    if [ ! -L "$cache" ]; then
        echo "FAIL: $cache is not a symlink"
        exit 1
    fi
    target="$(readlink -f "$cache")"
    if [ "$target" != "$PLUGIN_ROOT" ]; then
        echo "FAIL: symlink points to $target, expected $PLUGIN_ROOT"
        exit 1
    fi
done
echo "PASS: symlinks created correctly"

echo ""
echo "=== Test: dev-check passes after install ==="
bash "$PLUGIN_ROOT/scripts/dev-check.sh"
echo "PASS: dev-check reports all OK"

echo ""
echo "=== Test: dev-install is idempotent ==="
bash "$PLUGIN_ROOT/scripts/dev-install.sh"
echo "PASS: second run succeeded without error"

echo ""
echo "=== Test: dev-install recovers from clobbered symlink ==="
cache="$TMPDIR/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.0"
rm "$cache"
mkdir -p "$cache"
touch "$cache/fake-cached-file.txt"

bash "$PLUGIN_ROOT/scripts/dev-install.sh"

if [ ! -L "$cache" ]; then
    echo "FAIL: did not restore symlink after clobber"
    exit 1
fi
echo "PASS: symlink restored after clobber"

echo ""
echo "=== Test: dev-check detects wrong symlink target ==="
cache2="$TMPDIR/.claude/plugins/cache/sdd-misc-plugins/buddy/0.1.0"
rm "$cache2"
ln -s /tmp "$cache2"
bash "$PLUGIN_ROOT/scripts/dev-check.sh" && { echo "FAIL: expected exit 1 for wrong target"; exit 1; } || true
echo "PASS: dev-check detects wrong symlink target"

echo ""
echo "All tests passed."
