#!/bin/bash
# PreToolUse hook — IL4 deny guard on mcp__codescout__read_file (markdown paths).
#
# IL4 (Iron Law 4): NEVER read_file markdown → read_markdown. Markdown files
# must use the heading-addressed read_markdown tool — heading navigation,
# slice-able body, smaller payload than raw file read.
#
# The in-server tool gate already hard-rejects read_file(*.md) with the hint
# "Use read_markdown for markdown files". This hook catches it pre-call so
# the round-trip and tool_calls row are saved.
#
# Promoted from H-2 (proposed) on 2026-05-24, shipped direct-deny (no warn
# stage). Justification: the predicate is universally invalid — there is no
# legitimate read_file(*.md) call, so the warn stage carries zero FP risk
# and only delays substrate enforcement. See H-2 in
# code-explorer:docs/trackers/codescout-usage-hookify.md.

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL_NAME" in
  mcp__*__read_file) ;;
  *) exit 0 ;;
esac

PATH_ARG=$(echo "$INPUT" | jq -r '.tool_input.path // empty' 2>/dev/null)
[ -z "$PATH_ARG" ] && exit 0

# Match .md suffix (case-insensitive — covers .md, .MD, .Md, .mD).
# Narrow ship: .markdown / .mdx not included; add if observed in usage.
case "$PATH_ARG" in
  *.md|*.MD|*.Md|*.mD) ;;
  *) exit 0 ;;
esac

REASON="IL4 violation — \`read_file(path=\"${PATH_ARG}\")\` on markdown. BLOCKED.

Markdown files must use \`read_markdown(path)\` — heading-addressed,
size-adaptive, slice-able. \`read_file\` on \`.md\` is also hard-rejected by
the in-server gate; calling it costs a wasted round-trip and a
\`tool_calls\` row.

Use \`read_markdown\` first try:
  • read_markdown(path)                              — heading map
  • read_markdown(path, heading=\"## Section\")        — single section
  • read_markdown(path, headings=[\"## A\", \"## B\"])  — multi-section
  • read_markdown(path, start_line=N, end_line=M)    — line slice"

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
