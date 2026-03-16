#!/usr/bin/env bash
# PostCompact hook — flush stale LSP position caches after context compaction.
#
# After the context window is compacted, any cached LSP symbol positions may
# refer to line numbers that no longer match the agent's view of the source.
# This hook calls project_status(post_compact=true) which evicts all LSP
# clients; they restart lazily on the next navigation call (goto_definition,
# hover, find_references) with a clean position cache.
#
# We cannot call MCP tools directly from a shell hook — hooks run outside the
# MCP transport. Instead, inject a directive into additionalContext instructing
# the agent to perform the flush as its first action this turn.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
[ -z "$CWD" ] && CWD="$PWD"

source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODESCOUT" = "false" ] && exit 0

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostCompact",
    additionalContext: "codescout PostCompact: context was compacted.\n→ Call project_status({\"post_compact\": true}) as your FIRST action to flush stale LSP position caches.\n   LSP clients restart lazily — no disruption to the session."
  }
}'
