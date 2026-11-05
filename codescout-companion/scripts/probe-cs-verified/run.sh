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
#   hook-mode (end-to-end, the SHIPPED hook codescout-companion/hooks/cs-verified-relocate.mjs): a `+`-separated
#                list of registrations, in registration order, from:
#                  shipped  one throwaway plugin (--plugin-dir; its hooks/*.mjs are SYMLINKS to the worktree's shipped
#                           files) whose hooks.json runs wrap_shipped.py (logs stdin/stdout/exit/stderr, passes them
#                           through) around `node ${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs`; matcher
#                           mcp__codescout__.*, timeout 5
#                  exact    a plugin whose hooks.json holds the shipped entry verbatim, no wrapper (what hook_response in
#                           the stream shows is all there is)
#                  crash    as shipped, but the plugin holds COPIES whose cs-verified-relocate.mjs throws on its first line
#                  standin  a plugin whose hooks.json has one PostToolUse hook with NO matcher (standin.py: prints
#                           [cs-hint] stand-in), as the buddy plugin's unmatched hook does
#                  standinslow  as standin, but sleeps 1.5 s before it prints
#                  settingsref  (no plugin) the shipped entry verbatim in --settings; the CLI refuses to run it
#                One plugin per token, passed as repeated --plugin-dir in token order. The plugins are not installed
#                anywhere. (A settings.json hook cannot carry ${CLAUDE_PLUGIN_ROOT}: the CLI refuses it, see results.md.)
#   stub-mode    also: false (advice.verified false) | hintonly (hint, no advice), see stub_mcp.py
#
# Inputs (for this script, not passed to the CLI):
#   PROBE_RESUME_FROM=<label>  resume the session of an earlier run: its config dir and cwd are reused (the session
#                     is keyed on both), `--resume <that session id>` replaces `--session-id`; this run's own dir holds
#                     only its logs. PROBE_FORK=1 adds --fork-session.
#   PROBE_PROMPT      replace the default prompt
#   PROBE_INTERACTIVE=1  no -p: pty_drive.py runs the CLI under a pty (prompt 1, /clear, prompt 2, /exit; PROBE_PROMPT1,
#                     PROBE_PROMPT2, PROBE_INTERACTIVE_CLEAR=0 to skip /clear). No stream.jsonl; the cost comes from the
#                     `cost-state` rows of the session transcripts, and the first session's transcript is copied to
#                     transcript.jsonl, the one after /clear to transcript-after-clear.jsonl; evidence is also hook-log.jsonl,
#                     pty.log and pty-steps.txt. NO CLI-ENFORCED COST CAP: --max-budget-usd only works with --print, so an
#                     interactive run is bounded only by pty_drive.py's fixed script (two prompts, /clear, /exit; the
#                     timeouts there). cmd.txt holds the argv actually passed (without -p and without --max-budget-usd).
#   PROBE_OUT         directory for run dirs (outside any repo; required)
#   PROBE_TOKEN_FILE  mode-0600 file holding one long-lived Claude Code OAuth token (required)
#   PROBE_POLLUTE=1   also hand the CLI fake values for the host-signal variables (CLAUDECODE,
#                     CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SESSION_ID, AI_AGENT, CLAUDE_PROJECT_DIR,
#                     CLAUDE_EFFORT, CLAUDE_PID, CLAUDE_PLUGIN_ROOT) to see which ones the CLI overwrites
#
# The CLI runs with an explicit environment (execve, the `env -i` equivalent) of exactly: HOME, PATH (fixed below), CLAUDE_CONFIG_DIR (a fresh
# directory inside the run dir, so no profile config dir is read or written), CLAUDE_CODE_OAUTH_TOKEN
# (from PROBE_TOKEN_FILE) and DISABLE_AUTOUPDATER=1. No environment variable of the calling session leaks in.
# Settings files: only --settings (plus --setting-sources local in an empty cwd). Not isolated from that:
# the CLI still loads its builtin plugins (4 on 2.1.318: cc-plugin-agents-md, -telemetry, -privacy,
# -plugin-authoring; 3 on 2.1.311, without -privacy; listed in the stream's init event) and fetches
# remote-settings.json ({} in every run) and policy-limits.json from the network into the run's config dir.
# Evidence: stream.jsonl (with --include-hook-events), the session transcript (copied to
# transcript.jsonl), hook-log.jsonl (what the hook process received).
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
VER="$1"; LABEL="$2"; STUB="$3"; HOOK="$4"; TMO="${5:-}"; KIND="${6:-main}"
BIN="$HOME/.local/share/claude/versions/$VER"
: "${PROBE_OUT:?set PROBE_OUT}"; : "${PROBE_TOKEN_FILE:?set PROBE_TOKEN_FILE}"
case "$LABEL" in
  ""|*/*|*..*) echo "run.sh: label must be a non-empty single path component without '..': '$LABEL'" >&2; exit 2 ;;
esac
if [ ! -f "$PROBE_TOKEN_FILE" ] || [ -L "$PROBE_TOKEN_FILE" ] || [ "$(stat -c %a "$PROBE_TOKEN_FILE")" != 600 ]; then
  echo "run.sh: PROBE_TOKEN_FILE must be a regular file with mode 0600" >&2; exit 2
fi
RUN="$PROBE_OUT/$LABEL"
FROM="${PROBE_RESUME_FROM:-}"
case "$FROM" in */*|*..*) echo "run.sh: PROBE_RESUME_FROM must be a single path component: '$FROM'" >&2; exit 2 ;; esac
if [ -n "$FROM" ]; then
  [ "$FROM" != "$LABEL" ] || { echo "run.sh: label equals PROBE_RESUME_FROM" >&2; exit 2; }
  CFG="$PROBE_OUT/$FROM/config"; WORKD="$PROBE_OUT/$FROM/work"
  [ -d "$CFG" ] && [ -d "$WORKD" ] && [ -f "$PROBE_OUT/$FROM/session-id.txt" ] || { echo "run.sh: no run '$FROM' to resume" >&2; exit 2; }
  rm -rf "$RUN"; mkdir -p "$RUN"
else
  CFG="$RUN/config"; WORKD="$RUN/work"
  rm -rf "$RUN"; mkdir -p "$WORKD" "$CFG"
fi
echo "binary: $("$BIN" --version 2>&1 | head -1)  sha256: $(sha256sum "$BIN" | cut -c1-16)" > "$RUN/binary.txt"
printf '{"mcpServers": {"codescout": {"command": "/usr/bin/python3", "args": ["-I", "%s/stub_mcp.py", "%s"]}}}\n' \
  "$D" "$STUB" > "$RUN/mcp.json"
PLUGIN=()
case "${HOOK%%+*}" in shipped|exact|crash|standin|standinslow) E2E=1 ;; *) E2E=0 ;; esac
if [ "$HOOK" = none ]; then
  echo '{}' > "$RUN/settings.json"
elif [ "$HOOK" = settingsref ]; then
  # the shipped registration entry verbatim in --settings: measured to be refused by the CLI (see results.md)
  printf '{"hooks": {"PostToolUse": [{"matcher": "mcp__codescout__.*", "hooks": [{"type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs", "timeout": 5}]}]}}\n' > "$RUN/settings.json"
elif [ "$E2E" = 1 ]; then
  echo '{}' > "$RUN/settings.json"
  # One throwaway plugin per token, in token order (a repeated --plugin-dir; nothing is installed in any profile).
  # The CLI refuses a settings.json hook whose command contains ${CLAUDE_PLUGIN_ROOT} (measured, see results.md), so the
  # shipped registration entry can only be run as a plugin hook, which is also how the companion ships it.
  mapfile -t PDIRS < <(/usr/bin/python3 -I -c '
import json, os, shutil, sys
run, d, spec, comp = sys.argv[1:5]
log = run + "/hook-log.jsonl"
match = "mcp__codescout__.*"
script = "${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs"
for i, tok in enumerate(spec.split("+")):
    p = f"{run}/plugin-{i}-{tok}"
    os.makedirs(p + "/.claude-plugin"); os.makedirs(p + "/hooks")
    json.dump({"name": f"cs-verified-e2e-{i}-{tok}", "version": "0.0.0"}, open(p + "/.claude-plugin/plugin.json", "w"))
    if tok in ("shipped", "exact", "crash"):
        for f in sorted(os.listdir(comp + "/hooks")):
            if f.endswith(".mjs") and not f.endswith(".test.mjs"):
                if tok == "crash":
                    shutil.copy(f"{comp}/hooks/{f}", f"{p}/hooks/{f}")
                else:
                    os.symlink(f"{comp}/hooks/{f}", f"{p}/hooks/{f}")  # the shipped files themselves
        if tok == "crash":
            s = open(p + "/hooks/cs-verified-relocate.mjs").read()
            open(p + "/hooks/cs-verified-relocate.mjs", "w").write(
                "throw new Error(\"PROBE_CRASH_8K: cs-verified probe crash\");\n" + s)
    if tok in ("shipped", "crash"):
        cmd = f"/usr/bin/python3 -I {d}/wrap_shipped.py {log} {script} {tok}"
        entry = {"matcher": match, "hooks": [{"type": "command", "command": cmd, "timeout": 5}]}
    elif tok == "exact":
        entry = {"matcher": match, "hooks": [{"type": "command", "command": "node " + script, "timeout": 5}]}
    elif tok in ("standin", "standinslow"):
        cmd = f"/usr/bin/python3 -I {d}/standin.py {log}" + (" 1.5" if tok == "standinslow" else "")
        entry = {"hooks": [{"type": "command", "command": cmd}]}
    else:
        raise SystemExit("run.sh: unknown hook token " + tok)
    json.dump({"hooks": {"PostToolUse": [entry]}}, open(p + "/hooks/hooks.json", "w"))
    print(p)
' "$RUN" "$D" "$HOOK" "$(cd "$D/../.." && pwd)")
  for p in "${PDIRS[@]}"; do PLUGIN+=(--plugin-dir "$p"); done
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
[ -n "${PROBE_PROMPT:-}" ] && PROMPT="$PROBE_PROMPT"
if [ -n "$FROM" ]; then
  SID="$(cat "$PROBE_OUT/$FROM/session-id.txt")"
  SESSION_ARGS=(--resume "$SID"); [ "${PROBE_FORK:-}" = 1 ] && SESSION_ARGS+=(--fork-session)
else
  SID="$(/usr/bin/python3 -I -c 'import uuid;print(uuid.uuid4())')"
  SESSION_ARGS=(--session-id "$SID")
fi
echo "$SID" > "$RUN/session-id.txt"
echo "HOME PATH CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN DISABLE_AUTOUPDATER" > "$RUN/env-passed.txt"
[ "${PROBE_POLLUTE:-}" = 1 ] && echo "polluted: CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID AI_AGENT CLAUDE_PROJECT_DIR CLAUDE_EFFORT CLAUDE_PID CLAUDE_PLUGIN_ROOT" >> "$RUN/env-passed.txt"
ARGS=(-p "$PROMPT" --model claude-haiku-5-5 "${SESSION_ARGS[@]}" --setting-sources local
      --mcp-config "$RUN/mcp.json" --strict-mcp-config --settings "$RUN/settings.json"
      "${TOOLS[@]}" "${PLUGIN[@]}" --max-budget-usd 0.25
      --output-format stream-json --verbose --include-hook-events)
if [ "${PROBE_INTERACTIVE:-}" = 1 ]; then
  IARGS=(--model claude-haiku-5-5 "${SESSION_ARGS[@]}" --setting-sources local --mcp-config "$RUN/mcp.json"
         --strict-mcp-config --settings "$RUN/settings.json" "${TOOLS[@]}" "${PLUGIN[@]}")
  printf '%q ' "$BIN" "${IARGS[@]}" > "$RUN/cmd.txt"
else
  printf '%q ' "$BIN" "${ARGS[@]}" > "$RUN/cmd.txt"
fi
echo >> "$RUN/cmd.txt"
cd "$WORKD"
T0=$(date +%s.%N)
set +e
# `env -i` equivalent via execve, so the token never appears on a command line.
if [ "${PROBE_INTERACTIVE:-}" = 1 ]; then
  # interactive (no -p): pty_drive.py runs the same CLI under a pty with the same explicit environment (+ TERM)
  /usr/bin/python3 -I "$D/pty_drive.py" "$HOME" "$CFG" "$PROBE_TOKEN_FILE" "$BIN" "$WORKD" "$RUN" \
    "${IARGS[@]}" > "$RUN/stream.jsonl" 2> "$RUN/stderr.txt"
else
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
' "$HOME" "$CFG" "$PROBE_TOKEN_FILE" "$BIN" "${ARGS[@]}" > "$RUN/stream.jsonl" 2> "$RUN/stderr.txt"
fi
echo "exit: $?" > "$RUN/exit.txt"
set -e
T1=$(date +%s.%N)
echo "wall_s: $(echo "$T1 - $T0" | bc)" >> "$RUN/exit.txt"
# a forked run has a new session id: take the one the stream's init event reports
SID2="$(jq -r 'select(.type=="system" and .subtype=="init") | .session_id' "$RUN/stream.jsonl" 2>/dev/null | head -1 || true)"
[ -n "$SID2" ] && echo "$SID2" > "$RUN/stream-session-id.txt"
TP="$(ls "$CFG"/projects/*/"${SID2:-$SID}".jsonl 2>/dev/null | head -1 || true)"
[ -n "$TP" ] && cp "$TP" "$RUN/transcript.jsonl"
if [ "${PROBE_INTERACTIVE:-}" = 1 ]; then
  # /clear starts a new session with its own transcript: keep the one(s) other than the first session's
  for f in "$CFG"/projects/*/*.jsonl; do
    [ "$(basename "$f" .jsonl)" = "$SID" ] && continue
    cp "$f" "$RUN/transcript-after-clear.jsonl"
  done
fi
COST="$(jq -r 'select(.type=="result") | .total_cost_usd' "$RUN/stream.jsonl" 2>/dev/null | tail -1)"
COST_SRC="result event of the stream"
if [ "${PROBE_INTERACTIVE:-}" = 1 ]; then
  # an interactive session has no result event: sum the last cost-state row of each session transcript
  # (for -p runs that row equals the result event's cost, e.g. e318-b-two 0.00038952)
  COST="$(cat "$CFG"/projects/*/*.jsonl | jq -s -r '[.[] | select(.type=="cost-state")] | group_by(.sessionId) | map(last | .totalCostUSD) | add' 2>/dev/null || true)"
  COST_SRC="cost-state rows of the session transcripts"
fi
echo "cost_usd: ${COST:-unknown}" >> "$RUN/exit.txt"
echo "cost_source: $COST_SRC" >> "$RUN/exit.txt"
cat "$RUN/exit.txt"
