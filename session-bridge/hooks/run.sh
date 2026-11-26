#!/bin/sh
# Claude Code hook entry for session-bridge: hand the event to the binary, which is fail-open.
# No binary installed yet: do nothing, exit 0.
bin="$HOME/.cargo/bin/session-bridge"; [ -x "$bin" ] || exit 0
case "$1" in
  watch)
    # Mirrors wake::wake_enabled: no marker file, no watcher.
    [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-bridge-wake" ] || exit 0
    # A binary without the watch mode must stay silent, not exit 2.
    "$bin" help watch >/dev/null 2>&1 || exit 0
    exec "$bin" watch ;;
  *) exec "$bin" hook "$1" ;;
esac
