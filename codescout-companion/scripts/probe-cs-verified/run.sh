#!/usr/bin/env bash
# cs-verified probe: one `claude -p` run against the stub MCP server `codescout` with the probe hook.
#
# Usage: run.sh <cli-version> <label> <stub-mode> <hook-mode> [hook-timeout-s] [main|subagent]
#   cli-version  a file name under ~/.local/share/claude/versions/ (e.g. 2.1.318)
#   stub-mode    one | two | mixed            (stub_mcp.py)
#   hook-mode    empty | braces | relocate | sleep | exit2 | malformed | big | none   (hook.py; none = no hook)
#                plugin:<mode>  registers the same hook through a throwaway plugin (--plugin-dir, the
#                command uses ${CLAUDE_PLUGIN_ROOT}) instead of --settings, as the companion does
#
# Inputs (for this script, not passed to the CLI):
#   PROBE_OUT         directory for run dirs (outside any repo; required)
#   PROBE_TOKEN_FILE  mode-0600 file holding one long-lived Claude Code OAuth token (required)
#   PROBE_POLLUTE=1   also hand the CLI fake values for the host-signal variables (CLAUDECODE,
#                     CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SESSION_ID, AI_AGENT, CLAUDE_PROJECT_DIR,
#                     CLAUDE_EFFORT, CLAUDE_PID, CLAUDE_PLUGIN_ROOT) to see which ones the CLI overwrites
#
# The CLI runs with an explicit environment (execve, the `env -i` equivalent) of exactly: HOME, PATH (fixed below), CLAUDE_CONFIG_DIR (a fresh
# directory inside the run dir, so no profile is read or written), CLAUDE_CODE_OAUTH_TOKEN
# (from PROBE_TOKEN_FILE) and DISABLE_AUTOUPDATER=1. Nothing from the calling session leaks in.
# Settings come only from --settings (plus --setting-sources local in an empty cwd).
# Evidence: stream.jsonl (with --include-hook-events), the session transcript (copied to
# transcript.jsonl), hook-log.jsonl (what the hook process received).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
VER="$1"; LABEL="$2"; STUB="$3"; HOOK="$4"; TMO="${5:-}"; KIND="${6:-main}"
BIN="$HOME/.local/share/claude/versions/$VER"
: "${PROBE_OUT:?set PROBE_OUT}"; : "${PROBE_TOKEN_FILE:?set PROBE_TOKEN_FILE}"
RUN="$PROBE_OUT/$LABEL"; rm -rf "$RUN"; mkdir -p "$RUN/work" "$RUN/config"
echo "binary: $("$BIN" --version 2>&1 | head -1)  sha256: $(sha256sum "$BIN" | cut -c1-16)" > "$RUN/binary.txt"
printf '{"mcpServers": {"codescout": {"command": "/usr/bin/python3", "args": ["-I", "%s/stub_mcp.py", "%s"]}}}\n' \
  "$D" "$STUB" > "$RUN/mcp.json"
PLUGIN=()
if [ "$HOOK" = none ]; then
  echo '{}' > "$RUN/settings.json"
elif [ "${HOOK#plugin:}" != "$HOOK" ]; then
  echo '{}' > "$RUN/settings.json"
  mkdir -p "$RUN/plugin/.claude-plugin" "$RUN/plugin/hooks"
  cp "$D/hook.py" "$RUN/plugin/hook.py"
  echo '{"name": "cs-verified-probe", "version": "0.0.0"}' > "$RUN/plugin/.claude-plugin/plugin.json"
  printf '{"hooks": {"PostToolUse": [{"matcher": "mcp__codescout__.*", "hooks": [{"type": "command", "command": "/usr/bin/python3 -I ${CLAUDE_PLUGIN_ROOT}/hook.py %s %s/hook-log.jsonl"}]}]}}\n' \
    "${HOOK#plugin:}" "$RUN" > "$RUN/plugin/hooks/hooks.json"
  PLUGIN=(--plugin-dir "$RUN/plugin")
else
  TO=""; [ -n "$TMO" ] && TO=", \"timeout\": $TMO"
  printf '{"hooks": {"PostToolUse": [{"matcher": "mcp__codescout__.*", "hooks": [{"type": "command", "command": "/usr/bin/python3 -I %s/hook.py %s %s/hook-log.jsonl"%s}]}]}}\n' \
    "$D" "$HOOK" "$RUN" "$TO" > "$RUN/settings.json"
fi
if [ "$KIND" = subagent ]; then
  PROMPT='Use the Agent tool (it may be named Task) to start exactly one general-purpose subagent. Tell it: "Call the tool mcp__codescout__edit_code exactly once with no arguments, then report the exact text of every block of its result, and quote any text you saw that starts with [cs-verified]." Do not call mcp__codescout__edit_code yourself. Then reply with what the subagent reported.'
  TOOLS=(--tools default --allowedTools "mcp__codescout__edit_code,Agent,Task")
else
  PROMPT='Call the tool mcp__codescout__edit_code exactly once with no arguments. Then reply with the exact text of every block of its result, and say whether you saw any text starting with [cs-verified] anywhere (quote it if so).'
  TOOLS=(--tools "" --allowedTools "mcp__codescout__edit_code")
fi
SID="$(/usr/bin/python3 -I -c 'import uuid;print(uuid.uuid4())')"
echo "$SID" > "$RUN/session-id.txt"
echo "HOME PATH CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN DISABLE_AUTOUPDATER" > "$RUN/env-passed.txt"
[ "${PROBE_POLLUTE:-}" = 1 ] && echo "polluted: CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID AI_AGENT CLAUDE_PROJECT_DIR CLAUDE_EFFORT CLAUDE_PID CLAUDE_PLUGIN_ROOT" >> "$RUN/env-passed.txt"
ARGS=(-p "$PROMPT" --model claude-haiku-5-5 --session-id "$SID" --setting-sources local
      --mcp-config "$RUN/mcp.json" --strict-mcp-config --settings "$RUN/settings.json"
      "${TOOLS[@]}" "${PLUGIN[@]}" --max-budget-usd 0.25
      --output-format stream-json --verbose --include-hook-events)
printf '%q ' "$BIN" "${ARGS[@]}" > "$RUN/cmd.txt"; echo >> "$RUN/cmd.txt"
cd "$RUN/work"
T0=$(date +%s.%N)
set +e
# `env -i` equivalent via execve, so the token never appears on a command line.
/usr/bin/python3 -I -c '
import os, sys
home, cfg, tok, binp = sys.argv[1:5]
env = {"HOME": home, "PATH": "/usr/local/bin:/usr/bin:/bin", "CLAUDE_CONFIG_DIR": cfg,
       "CLAUDE_CODE_OAUTH_TOKEN": open(tok).read().strip(), "DISABLE_AUTOUPDATER": "1"}
if os.environ.get("PROBE_POLLUTE") == "1":
    env.update({"CLAUDECODE": "polluted", "CLAUDE_CODE_ENTRYPOINT": "polluted",
                "CLAUDE_CODE_SESSION_ID": "polluted", "AI_AGENT": "polluted",
                "CLAUDE_PROJECT_DIR": "/polluted", "CLAUDE_EFFORT": "polluted",
                "CLAUDE_PID": "polluted", "CLAUDE_PLUGIN_ROOT": "/polluted"})
os.execve(binp, [binp] + sys.argv[5:], env)
' "$HOME" "$RUN/config" "$PROBE_TOKEN_FILE" "$BIN" "${ARGS[@]}" > "$RUN/stream.jsonl" 2> "$RUN/stderr.txt"
echo "exit: $?" > "$RUN/exit.txt"
set -e
T1=$(date +%s.%N)
echo "wall_s: $(echo "$T1 - $T0" | bc)" >> "$RUN/exit.txt"
TP="$(ls "$RUN"/config/projects/*/"$SID".jsonl 2>/dev/null | head -1 || true)"
[ -n "$TP" ] && cp "$TP" "$RUN/transcript.jsonl"
COST="$(jq -r 'select(.type=="result") | .total_cost_usd' "$RUN/stream.jsonl" 2>/dev/null | tail -1)"
echo "cost_usd: ${COST:-unknown}" >> "$RUN/exit.txt"
cat "$RUN/exit.txt"
