#!/bin/bash
# PreToolUse hook — IL3 warn-first guard on mcp__codescout__run_command.
#
# IL3 (Iron Law 3): never pipe `run_command` output to log-trimmers
# (tail/head/grep/etc.). The @cmd_* buffer system stores full output and
# accepts follow-up queries — `grep PATTERN @cmd_id`, `tail -20 @cmd_id`.
# Piping wastes context tokens.
#
# This hook is warn-only by design: it allows the call but injects an
# additionalContext line so Claude sees the violation in the next turn
# and self-corrects. Telemetry-gathering phase before promotion to deny.
#
# Trigger: command starts with a build/test runner (cargo, npm, pytest, etc.)
# AND has a pipe whose post-pipe target is a log-trimmer (tail, head, grep,
# less, wc, sed, awk, cut, sort, uniq, tr, fmt).
#
# Allow-list pipes (jq, yq, fx, etc.) are simply not in the deny-pipe list —
# they fall through silently. `cargo metadata | jq '.packages'` is structured
# data flow, not log-trimming, so it's fine.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only fire on codescout run_command. Match the mcp__<server>__run_command shape.
case "$TOOL_NAME" in
  mcp__*__run_command) ;;
  *) exit 0 ;;
esac

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

# IL3 detection: <BUILD_TOOL> ... | <DENY_PIPE>
# Anchored at start to avoid catching mid-script pipes.
BUILD_TOOLS='(cargo|npm|pnpm|yarn|python|pytest|go|mvn|gradle)'
DENY_PIPE='(tail|head|grep|less|wc|sed|awk|cut|sort|uniq|tr|fmt)'

if ! echo "$CMD" | grep -qE "^[[:space:]]*${BUILD_TOOLS}[[:space:]].*\\|[[:space:]]*${DENY_PIPE}\\b"; then
  exit 0
fi

# Extract the lead command (before the first pipe) for the rewrite hint.
LEAD=$(echo "$CMD" | sed 's/[[:space:]]*|.*//' | sed 's/[[:space:]]*$//')

REASON="IL3 warning — piped \`${CMD}\` to a log-trimmer.

The @cmd_* buffer system saves context tokens:
  1. run_command(\"${LEAD}\")               — full output stored as @cmd_xxx
  2. grep PATTERN @cmd_xxx                 — query the buffer at any granularity
                                              (also: tail -20 @cmd_xxx, head -50 @cmd_xxx)

Allowed for now (warn-only mode). Get the buffer-query habit in before
this promotes to deny."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $reason
  }
}'
exit 0
