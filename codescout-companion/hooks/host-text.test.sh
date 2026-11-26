#!/usr/bin/env bash
# Host-specific hook text: a Codex session has no Skill tool, no ToolSearch and no /mcp, so the
# companion hooks must not tell it to use them (bug 2026-11-26, "Codex companion hooks suggest
# unavailable Claude Code tools"). The host is the nearest agent process above the hook, found by
# the comm of its parent: a script named `codex` or `claude` stands in for the real binary, which
# is exactly how lib.mjs isCodexProcess / isClaudeProcess recognise it (comm is the file name).
#
# Three hosts per message: Codex (no Claude Code wording), Claude Code (the wording stays: the
# control that the Codex branch did not just delete it) and no host (the default is Claude Code's).
# Machine-specific like session-start.test.sh: skips when codescout is not configured.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1${2:+ — $2}"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export TMPDIR="$TMP/tmp"; mkdir -p "$TMPDIR"

eval "$(CWD="$TMP" HOME="$HOME" CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}" python3 "$SCRIPT_DIR/../scripts/detect.py")"
if [ "${HAS_CODESCOUT:-false}" != "true" ]; then
  echo "SKIP: codescout not configured on this machine — the hooks emit nothing."; exit 0
fi

PROJ="$TMP/work/proj"; mkdir -p "$PROJ/src" "$TMP/bin"
printf '{"mcpServers":{"codescout":{"command":"/usr/local/bin/codescout","args":["serve"]}}}\n' > "$PROJ/.mcp.json"
echo 'fn main() {}' > "$PROJ/src/a.rs"
# The stand-ins: a bash script's comm is its file name.
for host in codex claude; do
  printf '#!/bin/bash\nnode "$@"\n' > "$TMP/bin/$host"; chmod +x "$TMP/bin/$host"
done

# Give the no-host fixture PID 1 as its parent even when this suite runs inside an agent.
cat > "$TMP/no-host.cjs" <<'JS'
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const readFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (path === `/proc/${process.pid}/stat`) return `${process.pid} (node) S 1\n`;
  return readFileSync.call(this, path, ...args);
};
syncBuiltinESMExports();
JS

# run <host|none> <hook.mjs> <json> -> the hook's stdout
run() {
  local host="$1" hook="$2" json="$3"
  if [ "$host" = none ]; then
    printf '%s' "$json" | XDG_STATE_HOME="$TMP/state" node --require "$TMP/no-host.cjs" "$SCRIPT_DIR/$hook" 2>/dev/null
  else
    printf '%s' "$json" | XDG_STATE_HOME="$TMP/state" "$TMP/bin/$host" "$SCRIPT_DIR/$hook" 2>/dev/null
  fi
}

has() { printf '%s' "$1" | grep -qF -- "$2"; }
n=0
check() {  # check <label> <text> <must-have|must-not> <needle>
  if [ "$3" = has ]; then has "$2" "$4" && pass "$1" || fail "$1" "missing: $4"
  else has "$2" "$4" && fail "$1" "present: $4" || pass "$1"; fi
}

# --- SessionStart ---
for host in codex claude none; do
  n=$((n+1))
  out="$(run $host session-start.mjs "{\"cwd\":\"$PROJ\",\"source\":\"startup\",\"session_id\":\"h$n\"}" | jq -r '.hookSpecificOutput.additionalContext // ""')"
  if [ -z "$out" ]; then fail "session-start/$host emits context"; continue; fi
  if [ $host = codex ]; then
    check "session-start/codex: no Skill() advice" "$out" not "Skill('codescout-companion"
    check "session-start/codex: no ToolSearch" "$out" not "ToolSearch"
    check "session-start/codex: names codex mcp list" "$out" has "codex mcp list"
  else
    check "session-start/$host: keeps the Skill() advice" "$out" has "Skill('codescout-companion:reconnaissance')"
    check "session-start/$host: keeps ToolSearch" "$out" has "ToolSearch"
    check "session-start/$host: names claude mcp list" "$out" has "claude mcp list"
  fi
done

# --- PreToolUse deny footer, then the repeat pointer inside the 3 s window, as the main agent ---
for host in codex claude none; do
  n=$((n+1))
  in="{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$PROJ/src/a.rs\"},\"cwd\":\"$PROJ\",\"session_id\":\"g$n\"}"
  out="$(run $host pre-tool-guard.mjs "$in" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')"
  if [ -z "$out" ]; then fail "pre-tool-guard/$host denies a native source Read"; continue; fi
  check "pre-tool-guard/$host: the footer opening is unchanged" "$out" has "If a tool named above is not in your tool list"
  if [ $host = codex ]; then
    check "pre-tool-guard/codex: no ToolSearch" "$out" not "ToolSearch"
    check "pre-tool-guard/codex: no /mcp" "$out" not "/mcp"
    check "pre-tool-guard/codex: no \"! <command>\"" "$out" not '"! <command>"'
    check "pre-tool-guard/codex: tells the user when no tool is present" "$out" has "tell the user"
  else
    check "pre-tool-guard/$host: keeps ToolSearch" "$out" has "ToolSearch"
    check "pre-tool-guard/$host: keeps /mcp" "$out" has "/mcp"
  fi
  rep="$(run $host pre-tool-guard.mjs "$in" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')"
  if [ $host = codex ]; then
    check "pre-tool-guard/codex: the repeat pointer has no ToolSearch" "$rep" not "ToolSearch"
  else
    check "pre-tool-guard/$host: the repeat pointer keeps ToolSearch" "$rep" has "ToolSearch"
  fi
done

# --- SubagentStart ---
for host in codex claude none; do
  n=$((n+1))
  out="$(run $host subagent-guidance.mjs "{\"hook_event_name\":\"SubagentStart\",\"cwd\":\"$PROJ\",\"session_id\":\"s$n\",\"agent_id\":\"a$n\"}" | jq -r '.hookSpecificOutput.additionalContext // ""')"
  if [ -z "$out" ]; then fail "subagent-guidance/$host emits context"; continue; fi
  if [ $host = codex ]; then
    check "subagent-guidance/codex: no ToolSearch" "$out" not "ToolSearch"
    check "subagent-guidance/codex: still names the tools" "$out" has "mcp__codescout__*"
  else
    check "subagent-guidance/$host: keeps the ToolSearch step" "$out" has "ONE ToolSearch call"
  fi
done

echo "── host-text: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
