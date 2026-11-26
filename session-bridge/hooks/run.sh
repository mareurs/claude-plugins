#!/bin/sh
# Claude Code hook entry for session-bridge: hand the event to the binary, which is fail-open.
# No binary installed yet: do nothing, exit 0.
bin="$HOME/.cargo/bin/session-bridge"; [ -x "$bin" ] || exit 0
# The same hooks.json runs under Codex when the plugin is added there. The binary's default harness
# is claude, so name Codex when the nearest agent process above us is `codex` (comm, as the
# companion's isCodexHost does). Linux only, like the bridge: no /proc means Claude Code.
host=claude; pid=$$; hop=0
while [ "$hop" -lt 10 ] && [ "${pid:-0}" -gt 1 ]; do
  case "$(cat "/proc/$pid/comm" 2>/dev/null)" in codex) host=codex; break ;; claude) break ;; esac
  pid="$(sed 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | cut -d' ' -f2)"; hop=$((hop + 1))
done
case "$1" in
  watch)
    # Claude Code only: a Codex session has its own wake hook and no Stop-driven watcher.
    [ "$host" = claude ] || exit 0
    # Mirrors wake::wake_enabled: no marker file, no watcher.
    [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-bridge-wake" ] || exit 0
    # A binary without the watch mode must stay silent, not exit 2.
    "$bin" help watch >/dev/null 2>&1 || exit 0
    exec "$bin" watch ;;
  *) if [ "$host" = codex ]; then exec "$bin" hook "$1" --harness codex; fi; exec "$bin" hook "$1" ;;
esac
