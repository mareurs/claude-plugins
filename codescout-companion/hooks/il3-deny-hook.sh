#!/bin/bash
# STATUS: PARKED AND UNWIRED since companion 1.16.9. This file does NOT run.
#
# It was wired as a deny hook in 4923f62, downgraded to warn-only in 50282a8 at
# the user's request (deny was high-friction), and kept in-repo deliberately for
# possible re-promotion; the warn hook that replaced it was later deleted
# outright (a989d73), leaving the `mcp__.*__run_command` matcher carrying nothing.
# See claude-plugins:docs/trackers/version-bump-checklist.md and codescout's
# docs/architecture/companion-plugin.md. Parked is not abandoned -- bb85c55 and
# 5f6b336 both synced this file to server-side changes while it was already
# unwired, and this header exists so that practice stays visible rather than
# being rediscovered as an oversight.
#
# KNOWN DIVERGENCE FROM THE SERVER, as of codescout 18f8f9d1:
#   * No `;` / `&&` / newline segment splitting. PRE_PIPE is everything before
#     the FIRST pipe in the whole command, so `cargo --version; ls | head -3`
#     reads as an unbounded LHS here and is allowed server-side. This gap
#     PREDATES 18f8f9d1 and is the one thing a re-promotion must fix first.
# Anything else here should match src/util/path_security.rs. If you re-promote
# this hook, diff it against that file before wiring it -- an unsynced mirror is
# what produced U-22 and U-44.
#
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
# whose post-pipe target is a log-trimmer (tail, head, grep, less, sed,
# awk, cut, sort, uniq, tr, fmt). Pure aggregators that collapse output to a
# summary — wc, and a counting grep -c/--count — are allowed, not trims.
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
#
# U-22 fix: literal `|` characters inside single- or double-quoted string
# content of the command (e.g. a `git commit -m "... 'yes | head -20' ..."`
# message body referring to a shell pipeline) used to trigger this match
# even though the `|` was never going to be evaluated as a pipe. Strip
# quoted substrings before the regex check.
#
# Single-quote stripping is exact — single-quoted strings in shell cannot
# contain a literal `'` (no escapes inside). Double-quote stripping ignores
# backslash-escaped `\"` inside the string, which is a slight over-strip
# but only risks a false negative on real IL3 (we'd miss a true pipe whose
# pre-pipe segment crosses an escaped-quote boundary — extremely rare in
# practice; better than the U-22 false positive shape).
DEQUOTED=$(echo "$CMD" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

# `cut` and `tr` are deliberately NOT in this list: they are 1:1 on records and
# cannot hide one, which is the information loss IL3 guards against. `sed`, `awk`
# and `sort` stay, drawn on capability rather than typical use -- `sed -n 1,10p`,
# `awk NR<10` and `sort -u` each drop records. Mirrors `stage_trims`.
DENY_PIPE='(tail|head|grep|less|sed|awk|sort|uniq|fmt)'
if ! echo "$DEQUOTED" | grep -qE "\\|[[:space:]]*${DENY_PIPE}\\b"; then
  exit 0
fi

# A stage that COLLAPSES the stream anywhere bounds the whole pipeline: nothing
# downstream can re-expand it, so a trimmer after it has nothing left to trim and
# the agent receives a count, a digest or one summary line either way. Mirrors
# `stage_collapses`.
#
# This subsumes the older, narrower rule that exempted a counting `grep -c` only
# when grep was the SOLE trimmer target -- and which therefore blocked
# `git log | grep fix | wc -l` while allowing `git log | grep -c fix`, the same
# single number reaching the agent by a different spelling.
if echo "$DEQUOTED" | grep -qE "\\|[[:space:]]*(wc|sha1sum|sha224sum|sha256sum|sha384sum|sha512sum|md5sum|b2sum|cksum|sum)\\b" \
   || echo "$DEQUOTED" | grep -qE "\\|[[:space:]]*grep\\b[^|]*(--count|-[A-Za-z]*c[A-Za-z]*)" \
   || echo "$DEQUOTED" | grep -qE "\\|[[:space:]]*git[[:space:]]+patch-id\\b"; then
  exit 0
fi

# Allow buffer-ops: pre-pipe segment references a buffer handle.
# Use DEQUOTED so a literal `|` inside a quoted substring (U-22) does not
# truncate PRE_PIPE at the wrong position. The result still names the
# first REAL command-position token, which is what HEAD needs.
PRE_PIPE=$(echo "$DEQUOTED" | sed 's/[[:space:]]*|.*//')
if echo "$PRE_PIPE" | grep -qE '@(cmd|bg|file|tool|ack)_[A-Za-z0-9_]+'; then
  exit 0
fi

# Identify LHS head token.
HEAD=$(echo "$PRE_PIPE" | awk '{print $1}')

is_unbounded=0

case "$HEAD" in
  cargo|npm|pnpm|yarn|python|python3|pytest|go|mvn|gradle|rg|fd)
    is_unbounded=1
    ;;
  git)
    # git is unbounded ONLY without an output limiter. Mirrors
    # `git_output_is_bounded` in codescout's src/util/path_security.rs --
    # keep the two in sync, per the Resume note in
    # docs/issues/archive/2026-05-18-il3-overtriggers-bounded-lhs.md.
    #
    # `--oneline` is deliberately absent: it bounds line WIDTH, not line
    # COUNT, so `git log --oneline` still emits one line per commit for
    # every commit.
    # Checked FIRST: single-line plumbing emits O(1) lines by construction and so
    # carries no limiter flag for the test below to find, which is how
    # `git rev-parse HEAD | head -1` -- 40 characters -- came to be refused as a
    # context-flooding risk. Mirrors `git_subcommand_is_single_line`. rev-parse
    # and config are excluded on their enumerating flags rather than dropped.
    if echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])git[[:space:]]+(patch-id|merge-base|symbolic-ref|describe|hash-object)([[:space:]]|$)'; then
      :
    elif echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])git[[:space:]]+rev-parse([[:space:]]|$)' \
         && ! echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])(--all|--branches|--tags|--remotes|--glob|--exclude)'; then
      :
    elif echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])git[[:space:]]+config([[:space:]]|$)' \
         && ! echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])(--list|-l|--get-all|--get-regexp)([[:space:]]|$)'; then
      :
    elif ! echo "$PRE_PIPE" | grep -qE '(^|[[:space:]])(-n|--max-count(=[0-9]+)?|--show-current|--porcelain|--short|-s|--stat|--name-only|--name-status|-[0-9]+)([[:space:]]|$)'; then
      is_unbounded=1
    fi
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
only unbounded LHS (cargo, npm, pytest, rg, fd, grep -r, bare find, ...) is blocked.
A pipeline that collapses ANYWHERE (wc, grep -c, sha256sum, git patch-id) is allowed whatever
follows it, and field selectors (cut, tr) are 1:1 on records so they never trim.
\`git\` is unbounded ONLY without an output limiter: \`git log -3\`, \`git status --short\`,
\`git show --stat\` are bounded and may be piped; \`--oneline\` is not a limiter.
Single-line plumbing (rev-parse, patch-id, merge-base, describe) is always bounded.

Rerun the command bare and query the returned @cmd_* buffer."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
