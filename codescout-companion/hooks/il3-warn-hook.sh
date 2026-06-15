#!/bin/bash
# PreToolUse hook — IL3 warn-first guard on mcp__codescout__run_command.
#
# IL3 (Iron Law 3): never pipe `run_command` output to log-trimmers
# (tail/head/grep/etc.). The @cmd_* buffer system stores full output and
# accepts follow-up queries — `grep PATTERN @cmd_id`, `tail -20 @cmd_id`.
# Piping wastes context tokens.
#
# This hook is advisory-only: it allows the call (exit 0) and injects an
# additionalContext line so Claude sees the violation in the next turn
# and self-corrects. NOTE: codescout's own run_command gate
# (path_security.rs) already denies unbounded-LHS pipes server-side;
# this hook is a redundant echo, not the enforcer.
#
# Trigger: command starts with a known LHS command (build/test runner OR
# git/find/ls/grep/cat/diff/du/stat/rg/fd — see telemetry comment near the
# detection block) AND has a pipe whose post-pipe target is a log-trimmer
# (tail, head, grep, less, sed, awk, cut, sort, uniq, tr, fmt). Pure
# aggregators that collapse output to a summary — wc, and a counting
# grep -c/--count — SAVE context and are NOT treated as trims.
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

# Allow buffer-ops: pre-pipe segment references a buffer handle (@cmd_*, @bg_*,
# @file_*, @tool_*, @ack_*). Operating on already-buffered data costs nothing
# in context — the capture has already happened.
PRE_PIPE=$(echo "$CMD" | sed 's/[[:space:]]*|.*//')
if echo "$PRE_PIPE" | grep -qE '@(cmd|bg|file|tool|ack)_[A-Za-z0-9_]+'; then
  exit 0
fi

# IL3 detection: <LHS_CMD> ... | <DENY_PIPE>
# Anchored at start to avoid catching mid-script pipes.
#
# Empirical (2026-05-18 telemetry): the original build-tools-only LHS caught
# 8/45 = 18% of real IL3 slips. Bulk of slip commands were git, find, ls, grep,
# cat, diff. Widened to cover those families. Recall ~93% projected, FP cost
# low (advisory-only — this hook never blocks; the server gate enforces).
LHS_COMMANDS='(cargo|npm|pnpm|yarn|python|pytest|go|mvn|gradle|git|find|ls|grep|cat|diff|du|stat|rg|fd)'
DENY_PIPE='(tail|head|grep|less|sed|awk|cut|sort|uniq|tr|fmt)'

if ! echo "$CMD" | grep -qE "^[[:space:]]*${LHS_COMMANDS}[[:space:]].*\\|[[:space:]]*${DENY_PIPE}\\b"; then
  exit 0
fi

# Pure aggregators on the RHS SAVE context (collapse output to a count) rather
# than trim it — allowed even from an unbounded LHS. `wc` is dropped from
# DENY_PIPE above; exempt a counting `grep -c`/`--count` when grep is the only
# trimmer target (mirrors stage_trims in codescout's path_security.rs).
if ! echo "$CMD" | grep -qE "\\|[[:space:]]*(tail|head|less|sed|awk|cut|sort|uniq|tr|fmt)\\b" \
   && echo "$CMD" | grep -qE "\\|[[:space:]]*grep\\b[^|]*(--count|-[A-Za-z]*c[A-Za-z]*)"; then
  exit 0
fi

# Extract the lead command (before the first pipe) for the rewrite hint.
LEAD=$(echo "$CMD" | sed 's/[[:space:]]*|.*//' | sed 's/[[:space:]]*$//')

REASON="IL3 warning — piped \`${CMD}\` to a log-trimmer.

The @cmd_* buffer system saves context tokens:
  1. run_command(\"${LEAD}\")               — full output stored as @cmd_xxx
  2. grep PATTERN @cmd_xxx                 — query the buffer at any granularity
                                              (also: tail -20 @cmd_xxx, head -50 @cmd_xxx)

codescout's run_command gate already denies unbounded-LHS pipes
server-side — this hook is an advisory echo, not the enforcer. Run
bare and query @cmd_xxx; bounded-LHS pipes (ls/cat/awk/sed/find
-maxdepth N) pass through."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $reason
  }
}'
exit 0
