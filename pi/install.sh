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

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MANUAL STEP — add servers to ~/.pi/agent/mcp.json

  codescout (for cs: line and recon badge):
    Ensure "codescout_grep" is in directTools.

  researcher (for /research-web and /research-subagent):
  {
    "mcpServers": {
      "researcher": {
        "type": "stdio",
        "command": "/path/to/researcher-mcp",
        "env": {
          "LLM_BASE_URL": "...",
          "LLM_MODEL":    "...",
          "LLM_API_KEY":  "...",
          "SEARXNG_URL":  "http://localhost:4000"
        }
      }
    },
    "directTools": ["grep", "researcher"]
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF

echo "done — run /reload in pi to activate"
