#!/bin/sh
# Claude Code hook entry for session-bridge: hand the event to the binary, which is fail-open.
# No binary installed yet: do nothing, exit 0.
bin="$HOME/.cargo/bin/session-bridge"; [ -x "$bin" ] || exit 0; exec "$bin" hook "$1"
