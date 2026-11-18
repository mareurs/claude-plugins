# Shared setup for the ES-17 probe scripts (throwaway; see README.md). Source it, do not run it.
#   PROBE_DIR  an empty scratch directory OUTSIDE any repo: run directories, logs and the assembled mods go here
#   CLAUDE_CONFIG_DIR  the profile whose credentials and transcripts the probes use (default ~/.claude)
: "${PROBE_DIR:?set PROBE_DIR to an empty scratch directory outside any repo}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SP="$PROBE_DIR"
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
export CFG
mkdir -p "$SP"

# assemble_mod NAME: build the plugin layout (.claude-plugin/plugin.json, hooks/hooks.json,
# hooks/register.ts) from the flat files in mods/NAME and print its directory. The repo keeps the
# mods flat so that no plugin folder inside the repo can be picked up by a loader or a validator.
assemble_mod() {
  local name="$1" d="$SP/mods/$1"
  mkdir -p "$d/.claude-plugin" "$d/hooks"
  cp "$HERE/mods/$name/plugin.json" "$d/.claude-plugin/plugin.json"
  cp "$HERE/mods/$name/hooks.json" "$d/hooks/hooks.json"
  cp "$HERE/mods/$name/register.ts" "$d/hooks/register.ts"
  printf '%s\n' "$d"
}
