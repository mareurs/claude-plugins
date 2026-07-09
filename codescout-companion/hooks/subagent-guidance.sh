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

# Inject the exploration protocol (project knowledge + evidence discipline) so coding
# subagents don't start blind. v1.1 folds in reconnaissance ingredients (run-the-call
# verification + doc-vs-code drift as a finding class) and a ledger-check report contract.
# Provenance: codescout docs/trackers/prompt-hamsa-audit-log.md A-16 (3-arm bug-hunt) + A-15.
MSG="$(cat <<'PROTO'
codescout EXPLORATION PROTOCOL — before exploring or auditing code:

Phase 0 — load what the project already knows (do FIRST):
• memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).
• Bug/regression hunts: artifact(action="find", kind="bug", status="open") — the known-bug ledger. Don't re-report a filed bug as new; mark rediscoveries KNOWN with the ledger path.
• If a get_guide topic matches your area (error-handling, progressive-disclosure, workspace-state, librarian, tracker-conventions), read it — it states the contract whose violations you hunt.

Phase 1 — route each lookup by what you know:
symbol name → symbols(name=X) | concept → semantic_search(query) | exact string → grep(pattern) | who calls X → references(symbol, path), never grep for callers.

Phase 2 — verify at the bytes, not from belief:
• A finding needs lines you actually read (symbols include_body / read_file), not a grep hit alone.
• For a claim about how a TOOL behaves, run the call once and read the real output — reading the source alone misses runtime shape.
• A comment / doc / README the code contradicts is itself a finding (doc-vs-code drift).

Report contract: cite file:line for every finding; end with "Ledger checked: <bug ids seen | none>". If you skipped Phase 0, say so.
PROTO
)"

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
