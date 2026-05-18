#!/bin/bash
# PreToolUse hook — IL3 deny guard on mcp__codescout__run_command.
#
# IL3 (Iron Law 3): never pipe `run_command` output to log-trimmers
# (tail/head/grep/etc.). The @cmd_* buffer system stores full output and
# accepts follow-up queries — `grep PATTERN @cmd_id`, `tail -20 @cmd_id`.
# Piping wastes context tokens.
#
# Promoted from warn-only on 2026-05-18. Warn-mode shipped multiple
# sessions; U-1 (45 strikes), U-3 (9 strikes in one session) both
# confirm the pattern recurs despite explicit warnings. The buffer-query
# habit needs substrate-level enforcement.
#
# Trigger: command starts with a known LHS command (build/test runner OR
# git/find/ls/grep/cat/diff/du/stat/rg/fd) AND has a pipe whose post-pipe
# target is a log-trimmer (tail, head, grep, less, wc, sed, awk, cut,
# sort, uniq, tr, fmt).
#
# Allow-list pipes (jq, yq, fx, etc.) are simply not in the deny-pipe list —
# they fall through silently. `cargo metadata | jq '.packages'` is structured
# data flow, not log-trimming, so it's fine.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL_NAME" in
  mcp__*__run_command) ;;
  *) exit 0 ;;
esac

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

LHS_COMMANDS='(cargo|npm|pnpm|yarn|python|pytest|go|mvn|gradle|git|find|ls|grep|cat|diff|du|stat|rg|fd)'
DENY_PIPE='(tail|head|grep|less|wc|sed|awk|cut|sort|uniq|tr|fmt)'

if ! echo "$CMD" | grep -qE "^[[:space:]]*${LHS_COMMANDS}[[:space:]].*\\|[[:space:]]*${DENY_PIPE}\\b"; then
  exit 0
fi

LEAD=$(echo "$CMD" | sed 's/[[:space:]]*|.*//' | sed 's/[[:space:]]*$//')

REASON="IL3 violation — piped \`${CMD}\` to a log-trimmer. BLOCKED.

The @cmd_* buffer system saves context tokens:
  1. run_command(\"${LEAD}\")               — full output stored as @cmd_xxx
  2. grep PATTERN @cmd_xxx                 — query the buffer at any granularity
                                              (also: tail -20 @cmd_xxx, head -50 @cmd_xxx)

Promoted from warn to deny on 2026-05-18 after 50+ slips across 3 sessions.
Rerun the command bare and query the returned @cmd_* buffer."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
