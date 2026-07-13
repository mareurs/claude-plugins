#!/usr/bin/env bash
# codescout-companion/hooks/detect.test.sh
# Parity: detect.mjs (JS port) must match detect.py (Python) byte-for-byte on --json.
# Ensures the Node hook foundation resolves codescout config identically to the
# existing Python detector before any hook is ported onto it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/../scripts/detect.py"
JS="$HERE/detect.mjs"
PASS=0
FAIL=0

echo "── detect.mjs ↔ detect.py parity ──"

cmp_case() { # desc cwd home ccd
  local desc="$1" cwd="$2" home="$3" ccd="${4:-}"
  local py js
  py="$(CWD="$cwd" HOME="$home" CLAUDE_CONFIG_DIR="$ccd" python3 "$PY" --json)"
  js="$(CWD="$cwd" HOME="$home" CLAUDE_CONFIG_DIR="$ccd" node "$JS" --json)"
  if [ "$py" = "$js" ]; then
    PASS=$((PASS + 1))
    echo "  PASS: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ FAIL: $desc"
    diff <(printf '%s' "$py") <(printf '%s' "$js") | head -30
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Case A — bare: no config anywhere.
mkdir -p "$TMP/a/cwd" "$TMP/a/home"
cmp_case "bare (no codescout)" "$TMP/a/cwd" "$TMP/a/home"

# Case B — .mcp.json declares a codescout server.
mkdir -p "$TMP/b/cwd" "$TMP/b/home"
cat > "$TMP/b/cwd/.mcp.json" <<'JSON'
{ "mcpServers": { "codescout": { "command": "/opt/bin/codescout", "args": ["start"] } } }
JSON
cmp_case ".mcp.json codescout server" "$TMP/b/cwd" "$TMP/b/home"

# Case C — routing override with block_reads + workspace_root (~ expansion).
mkdir -p "$TMP/c/cwd/.claude" "$TMP/c/home"
cat > "$TMP/c/cwd/.claude/codescout-companion.json" <<'JSON'
{ "server_name": "cs", "block_reads": false, "workspace_root": "~/ws" }
JSON
cmp_case "routing override (block_reads + workspace_root)" "$TMP/c/cwd" "$TMP/c/home"

# Case D — .codescout memories (sorted) + system-prompt + project.toml.
mkdir -p "$TMP/d/cwd/.codescout/memories" "$TMP/d/home"
echo "x" > "$TMP/d/cwd/.codescout/project.toml"
echo "b mem" > "$TMP/d/cwd/.codescout/memories/beta.md"
echo "a mem" > "$TMP/d/cwd/.codescout/memories/alpha.md"
echo "not md" > "$TMP/d/cwd/.codescout/memories/notes.txt"
echo "system prompt body" > "$TMP/d/cwd/.codescout/system-prompt.md"
cmp_case "memories + system-prompt + onboarding" "$TMP/d/cwd" "$TMP/d/home"

# Case E — user config (~/.claude.json) declares codescout, no CLAUDE_CONFIG_DIR.
mkdir -p "$TMP/e/cwd" "$TMP/e/home"
cat > "$TMP/e/home/.claude.json" <<'JSON'
{ "mcpServers": { "my-cs": { "command": "~/bin/codescout" } } }
JSON
cmp_case "user ~/.claude.json codescout (home-expanded binary)" "$TMP/e/cwd" "$TMP/e/home"

# Case F — CLAUDE_CONFIG_DIR set: profile config drives detection.
mkdir -p "$TMP/f/cwd" "$TMP/f/home" "$TMP/f/profile"
cat > "$TMP/f/profile/.claude.json" <<'JSON'
{ "mcpServers": { "codescout-sdd": { "command": "/usr/bin/codescout" } } }
JSON
cmp_case "CLAUDE_CONFIG_DIR profile config" "$TMP/f/cwd" "$TMP/f/home" "$TMP/f/profile"

echo "  detect parity: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
