#!/bin/bash
# SubagentStart hook — inject codescout guidance into all subagents
# Skips agents that don't do code work.

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# Skip agents that don't need code exploration guidance
case "$AGENT_TYPE" in
  Bash|statusline-setup|claude-code-guide)
    exit 0
    ;;
esac

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODESCOUT" = "false" ] && exit 0

# Always inject an active tool-use directive so coding subagents don't fall back
# to Read/Grep/Glob/Bash on source files. Append project system-prompt if present.
MSG="codescout: For ALL code navigation, use codescout tools — not Read/Grep/Glob/Bash on source files:
  symbols / semantic_search — discover code
  references / symbol_at — navigate relationships
  edit_code (LSP-aware; action=replace/insert/remove/rename) — edit code"

# --- Iron Laws reminder (survives context compression) ---
MSG="${MSG}

CODESCOUT RULES (compression-resilient reminder):
• Source code: symbols (list + find), NOT read_file/Read
• Code edits: edit_code (LSP-aware; action=replace/insert/remove/rename), NOT edit_file/Edit for structural changes
• Shell commands: run_command, NOT Bash — output buffers save tokens
• Markdown: read_markdown/edit_markdown, NOT read_file/edit_file
• Never pipe unbounded run_command output — run bare, query @cmd_* buffer (bounded LHS like ls, cat, awk, sed, find -maxdepth N is OK)"

# Subagents do NOT receive codescout's server_instructions (claude-code#29655), so the
# ## Custom Instructions block the main agent gets never reaches them. This verbatim
# injection of the root .codescout/system-prompt.md is the ONLY delivery path to subagents
# — do NOT remove it as "redundant with server_instructions". See
# docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md.
if [ "$HAS_CS_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}

${CS_SYSTEM_PROMPT}"
fi

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
