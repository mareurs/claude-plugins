#!/usr/bin/env bash
# install.sh — wire the codescout-companion bridge into OpenCode.
# Run from anywhere: paths resolve from this file, not from your CWD.
#
# What it does:  symlinks the plugin into OpenCode's plugin dir, and reports whether the
#                codescout MCP server is registered.
# What it does NOT do: edit your opencode.json. That file holds provider API keys on real
#                machines, and a script rewriting it is how a setup guide becomes a
#                data-loss story. The one config edit this install needs is shown to you
#                instead, and `--check` tells you whether you did it. (Same division of
#                labour as harnesses/pi/install.sh, which also leaves MCP to a manual
#                step — see its "MANUAL STEP" banner.)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_DIR/harnesses/opencode/codescout-companion.js"

# OpenCode loads plugins from the user config dir and from a project's .opencode/.
# $XDG_CONFIG_HOME wins over ~/.config, which is what the plugin itself assumes.
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
MODE="user"
[ "${1:-}" = "--project" ] && MODE="project"
[ "${1:-}" = "--check" ] && MODE="check"

target_dir() {
  case "$MODE" in
    project) echo "$PWD/.opencode/plugins" ;;
    *)       echo "$CONFIG_DIR/plugins" ;;
  esac
}

die()  { echo "error: $*" >&2; exit 1; }
info() { echo "  $*"; }

command -v node >/dev/null 2>&1 || die "'node' not found — the bridge spawns hooks with it"
[ -f "$SRC" ] || die "plugin source missing at $SRC (is this checkout intact?)"

# ── check mode: report, change nothing ────────────────────────────────────
if [ "$MODE" = "check" ]; then
  echo "codescout-companion ↔ OpenCode"
  found="no"
  for d in "$CONFIG_DIR/plugins" "$PWD/.opencode/plugins"; do
    if [ -L "$d/codescout-companion.js" ] || [ -f "$d/codescout-companion.js" ]; then
      found="yes"
      info "plugin present: $d/codescout-companion.js"
      [ -L "$d/codescout-companion.js" ] && info "  → $(readlink "$d/codescout-companion.js")"
    fi
  done
  [ "$found" = "no" ] && info "plugin NOT installed — run ./install.sh"
  for f in "$PWD/opencode.json" "$CONFIG_DIR/opencode.json"; do
    [ -f "$f" ] || continue
    command -v jq >/dev/null 2>&1 || continue
    if jq -e '.mcp.servers.codescout' "$f" >/dev/null 2>&1; then
      info "codescout MCP registered in $f"
    else
      info "codescout MCP NOT registered in $f  (see the mcp block the installer prints)"
    fi
  done
  exit 0
fi

DEST_DIR="$(target_dir)"
DEST="$DEST_DIR/codescout-companion.js"
mkdir -p "$DEST_DIR"

# Replace a stale link or an old copied file. Written the way pi's installer does it:
# a plain `-e` test is false for a dangling symlink, so both branches are reachable.
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  if [ -f "$DEST" ] && [ ! -L "$DEST" ]; then
    cp "$DEST" "$DEST.bak-$(date +%Y%m%d%H%M%S)"
    info "existing copy backed up"
  fi
  rm "$DEST"
fi
ln -s "$SRC" "$DEST"
info "linked plugin  → $DEST"
info "  source       $SRC"
info "  hooks it drives: $REPO_DIR/codescout-companion/hooks"
info "note: this is a symlink — if you move this repo, re-run this installer."

# ── the manual step: MCP registration ─────────────────────────────────────
REGISTERED="no"
for f in "$PWD/opencode.json" "$CONFIG_DIR/opencode.json"; do
  [ -f "$f" ] || continue
  command -v jq >/dev/null 2>&1 || continue
  jq -e '.mcp.servers.codescout' "$f" >/dev/null 2>&1 && REGISTERED="yes"
done

if [ "$REGISTERED" = "yes" ]; then
  echo
  info "codescout MCP is already registered — nothing else to do."
else
  cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUAL STEP — register the codescout MCP server

Add this to $CONFIG_DIR/opencode.json (or a project's opencode.json).
opencode exposes its tools as codescout_<tool>, which is what the bridge
matches on.

  "mcp": {
    "servers": {
      "codescout": {
        "type": "local",
        "command": ["codescout", "start", "--project", "."],
        "cwd": "."
      }
    }
  }

If your opencode.json has no "mcp" key yet, add the whole block above. If it
already has one, add only the "codescout" entry inside mcp.servers. Back the
file up first: cp $CONFIG_DIR/opencode.json $CONFIG_DIR/opencode.json.bak
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
fi

echo
echo "done — restart opencode to load the plugin."
echo "If a background 'opencode serve --service' is running, restarting the TUI is NOT enough:"
echo "it keeps the old plugin cached. Stop it first:  pgrep -af 'opencode.*serve --service'  then kill <pid>"
echo "verify with: $0 --check"
