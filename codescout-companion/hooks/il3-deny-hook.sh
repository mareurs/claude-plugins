#!/bin/bash
# PreToolUse hook — IL3 deny guard on mcp__codescout__run_command.
#
# IL3 (Iron Law 3): never pipe **live, unbounded** `run_command` output to
# log-trimmers (tail/head/grep/etc.). The @cmd_* buffer system stores full
# output and accepts follow-up queries — `grep PATTERN @cmd_id`,
# `tail -20 @cmd_id`. Piping unbounded output wastes context tokens.
#
# Promoted from warn-only on 2026-05-18. Refined on 2026-05-18 to allow
# bounded LHS (cat <file>, ls <dir>, non-recursive grep <pat> <file>, etc.)
# — see docs/issues/2026-05-18-il3-overtriggers-bounded-lhs.md.
#
# Trigger: command's first token is a known UNBOUNDED command AND has a pipe
# whose post-pipe target is a log-trimmer (tail, head, grep, less, wc, sed,
# awk, cut, sort, uniq, tr, fmt).
#
# Bounded LHS (ls, cat, stat, du, diff, awk, sed, non-recursive grep, find
# with -maxdepth) is allowed — their output is bounded by direct argument
# shape, so the buffer dance is pure overhead.
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

# Cheap reject: no log-trimmer on the RHS of any pipe → never IL3.
DENY_PIPE='(tail|head|grep|less|wc|sed|awk|cut|sort|uniq|tr|fmt)'
if ! echo "$CMD" | grep -qE "\\|[[:space:]]*${DENY_PIPE}\\b"; then
  exit 0
fi

# Allow buffer-ops: pre-pipe segment references a buffer handle.
PRE_PIPE=$(echo "$CMD" | sed 's/[[:space:]]*|.*//')
if echo "$PRE_PIPE" | grep -qE '@(cmd|bg|file|tool|ack)_[A-Za-z0-9_]+'; then
  exit 0
fi

# Identify LHS head token.
HEAD=$(echo "$PRE_PIPE" | awk '{print $1}')

is_unbounded=0

case "$HEAD" in
  cargo|npm|pnpm|yarn|python|python3|pytest|go|mvn|gradle|git|rg|fd)
    is_unbounded=1
    ;;
  grep)
    # Recursive grep is unbounded; non-recursive is bounded by file args.
    if echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])(-r|-R|--recursive)([[:space:]]|$)'; then
      is_unbounded=1
    fi
    ;;
  find)
    # find defaults to recursive; -maxdepth bounds it.
    if ! echo "$PRE_PIPE" | grep -qE '[[:space:]]-maxdepth[[:space:]=]'; then
      is_unbounded=1
    fi
    ;;
esac

[ "$is_unbounded" = 0 ] && exit 0

LEAD=$(echo "$PRE_PIPE" | sed 's/[[:space:]]*$//')

REASON="IL3 violation — piped \`${CMD}\` to a log-trimmer. BLOCKED.

The @cmd_* buffer system saves context tokens:
  1. run_command(\"${LEAD}\")               — full output stored as @cmd_xxx
  2. grep PATTERN @cmd_xxx                 — query the buffer at any granularity
                                              (also: tail -20 @cmd_xxx, head -50 @cmd_xxx)

Bounded LHS (ls, cat, stat, du, diff, awk, sed, non-recursive grep, find -maxdepth) is allowed —
only unbounded LHS (cargo, npm, pytest, git, rg, fd, grep -r, bare find, ...) is blocked.

Rerun the command bare and query the returned @cmd_* buffer."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
