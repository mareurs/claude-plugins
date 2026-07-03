#!/usr/bin/env bash
# install.sh — install pi companion extensions
# Run from this directory (claude-plugins/pi/).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
SETTINGS="$PI_DIR/settings.json"

die()  { echo "error: $*" >&2; exit 1; }
info() { echo "  $*"; }

command -v jq >/dev/null 2>&1 || die "'jq' not found — install it first"

# ── extension ──────────────────────────────────────────────────────────────

EXT_DIR="$PI_DIR/extensions"
mkdir -p "$EXT_DIR"

EXT_SRC="$REPO_DIR/pi/extensions/codescout-companion.ts"
EXT_DEST="$EXT_DIR/codescout-companion.ts"
[ -e "$EXT_DEST" ] && rm "$EXT_DEST"
ln -s "$EXT_SRC" "$EXT_DEST"
info "linked extension → $EXT_SRC"

# ── settings.json — skill dirs ─────────────────────────────────────────────

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

add_skill_dir() {
  local dir="$1"
  if ! jq -e --arg d "$dir" '.skills // [] | map(. == $d) | any' "$SETTINGS" | grep -q true; then
    local tmp; tmp=$(mktemp)
    jq --arg d "$dir" '.skills = ((.skills // []) + [$d] | unique)' "$SETTINGS" > "$tmp"
    mv "$tmp" "$SETTINGS"
    info "added skill dir: $dir"
  else
    info "already present:  $dir"
  fi
}

add_skill_dir "$REPO_DIR/codescout-companion/skills"   # reconnaissance, explore-project, researcher-*
add_skill_dir "$REPO_DIR/buddy/skills"                  # 12 specialist skills
add_skill_dir "$REPO_DIR/sdd/skills"                    # sdd-flow

# ── mcp.json hint ──────────────────────────────────────────────────────────
# NOTE: directTools is a per-server field nested inside mcpServers.<name>.
# grep is intentionally absent from codescout's directTools — it collides
# with pi's built-in grep; reach codescout's grep as codescout_grep instead.

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANUAL STEP — configure ~/.pi/agent/mcp.json

The codescout/contrib/pi install script manages this file. If you
are setting it up manually, see codescout/contrib/pi/mcp.json.example
or pi/README.md § Step 4 for the full format.

Minimal example (codescout only):
  {
    "mcpServers": {
      "codescout": {
        "command": "/home/you/.cargo/bin/codescout",
        "args": ["start"],
        "lifecycle": "lazy",
        "directTools": [
          "symbols", "symbol_at", "tree", "semantic_search", "references",
          "read_file", "read_markdown", "edit_code", "edit_file", "edit_markdown"
        ]
      }
    }
  }

Note: grep is absent from directTools — it collides with pi's built-in.
Use codescout_grep (mcp-prefixed) to reach codescout's grep tool.

For researcher-mcp, see pi/README.md § Step 4.

After editing mcp.json, run in pi:
  /mcp reconnect codescout

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF

echo "done — run /reload in pi to activate"
