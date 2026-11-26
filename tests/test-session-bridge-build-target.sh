#!/usr/bin/env bash
# tests/test-session-bridge-build-target.sh — session-bridge/scripts/build.sh builds outside the
# plugin directory. A target/ inside it is copied whole by `codex plugin add` (20 GB).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$HERE/../session-bridge/scripts/build.sh"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 ($2)"; FAIL=$((FAIL+1)); }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# A fake cargo that records the target dir it was given.
mkdir -p "$TMP/bin" "$TMP/home/.cargo/bin"
printf '#!/bin/sh\necho "$1=$CARGO_TARGET_DIR" >> "%s/seen"\n[ "$1" = install ] && : > "$HOME/.cargo/bin/session-bridge" && chmod +x "$HOME/.cargo/bin/session-bridge"\nexit 0\n' "$TMP" > "$TMP/bin/cargo"
chmod +x "$TMP/bin/cargo"

run() { env -u CARGO_TARGET_DIR HOME="$TMP/home" XDG_CACHE_HOME= PATH="$TMP/bin:$PATH" SESSION_BRIDGE_BIN_DIR="$TMP/home/.local/bin" "$@" bash "$BUILD" >/dev/null 2>&1; }

: > "$TMP/seen"; run env
if [ "$(sort -u "$TMP/seen" | sed 's/^[a-z]*=//' | sort -u)" = "$TMP/home/.cache/session-bridge/target" ]; then
  pass "default target dir is under the cache, not the plugin"
else fail "default target dir" "$(cat "$TMP/seen")"; fi

: > "$TMP/seen"; run env CARGO_TARGET_DIR="$TMP/mine"
[ "$(sed 's/^[a-z]*=//' "$TMP/seen" | sort -u)" = "$TMP/mine" ] && pass "a caller's CARGO_TARGET_DIR wins" || fail "caller dir" "$(cat "$TMP/seen")"

[ ! -e "$HERE/../session-bridge/mcp-server/target" ] && pass "no target/ inside the plugin directory" || fail "plugin dir" "target/ exists"

echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
