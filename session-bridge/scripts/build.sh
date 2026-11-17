#!/usr/bin/env bash
# session-bridge/scripts/build.sh — test, lint, install the binary, link it onto PATH.
#
# cargo installs to ${CARGO_HOME:-$HOME/.cargo}/bin (the Claude plugin and hooks/run.sh read it
# there). The OpenCode plugin and Codex find `session-bridge` through SESSION_BRIDGE_BIN or PATH,
# so the binary is also linked at ${SESSION_BRIDGE_BIN_DIR:-$HOME/.local/bin}/session-bridge.
# The link target is the cargo bin path, which no release changes, so it never goes stale.
# Re-running replaces the link (idempotent). SB_BUILD_SKIP_CARGO=1 skips test/clippy/install
# and only links (used by the tests).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${SB_BUILD_SKIP_CARGO:-}" ]; then
  cd "$ROOT/mcp-server"
  cargo test --quiet
  cargo clippy --all-targets --quiet -- -D warnings
  cargo install --path . --locked --quiet
fi
SRC="${CARGO_HOME:-$HOME/.cargo}/bin/session-bridge"
echo "binary: $SRC"
[ -x "$SRC" ] || { echo "error: $SRC missing after install" >&2; exit 1; }
DIR="${SESSION_BRIDGE_BIN_DIR:-$HOME/.local/bin}"
LINK="$DIR/session-bridge"
if [ "$DIR/session-bridge" -ef "$SRC" ] && [ ! -L "$LINK" ]; then
  echo "on PATH: $LINK (same file, no link needed)"
else
  if [ -e "$LINK" ] && [ ! -L "$LINK" ] && ! [ "$LINK" -ef "$SRC" ]; then
    echo "error: $LINK exists and is not a symlink; refusing to replace it. Move it away, or set SESSION_BRIDGE_BIN_DIR." >&2
    exit 1
  fi
  mkdir -p "$DIR"
  ln -sfn "$SRC" "$LINK"
  echo "linked: $LINK -> $SRC"
  case ":$PATH:" in *":$DIR:"*) ;; *) echo "note: $DIR is not on PATH; add it, or set SESSION_BRIDGE_BIN=$LINK" ;; esac
fi
