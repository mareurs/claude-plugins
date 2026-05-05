# Session Intelligence Hooks — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Inspired by:** [rohitg00/pro-workflow](https://github.com/rohitg00/pro-workflow) — session-aware hooks

## Problem

The codescout-companion plugin currently focuses on tool routing (steering agents toward
codescout MCP tools) and subagent guidance. It has no awareness of session-level state:
what the user originally asked for, how far the work has drifted, what happens during
context compaction, or what tool denials reveal about permission configuration.

Pro-workflow demonstrates three session-intelligence patterns that are directly applicable
to the companion plugin's hook infrastructure.

## Feature 1: Compact Guard

### Problem

When Claude Code compacts context (5 files, ~50K tokens), session state that isn't in
files gets lost — the agent's understanding of what it was doing, what corrections were
applied, which tools were problematic. The codescout memory system persists across
sessions, but mid-session compaction can still cause disorientation.

### Design

Two hooks working as a pair:

**`PreCompact` hook (`hooks/compact-save.sh`)**

Captures session state to a temp file before compaction:

```bash
#!/usr/bin/env bash
# Hook: PreCompact

STATE_DIR="${TMPDIR:-/tmp}/codescout-companion"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/compact-state-$$.json"

# Read hook input from stdin
INPUT=$(cat)

# Build state snapshot
cat > "$STATE_FILE" << SNAPSHOT
{
  "saved_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid": $$,
  "working_dir": "$(pwd)",
  "git_branch": "$(git branch --show-current 2>/dev/null || echo 'unknown')",
  "recent_files": $(git diff --name-only HEAD~3 2>/dev/null | head -10 | jq -R . | jq -s .),
  "active_task": "$(cat "$STATE_DIR/intent.txt" 2>/dev/null || echo '')"
}
SNAPSHOT

echo "$INPUT"
```

**`PostCompact` hook (`hooks/compact-restore.sh`)**

Restores context after compaction by emitting a summary to stderr (visible to the agent):

```bash
#!/usr/bin/env bash
# Hook: PostCompact

STATE_DIR="${TMPDIR:-/tmp}/codescout-companion"
STATE_FILE="$STATE_DIR/compact-state-$$.json"

INPUT=$(cat)

if [ -f "$STATE_FILE" ]; then
    BRANCH=$(jq -r '.git_branch' "$STATE_FILE")
    TASK=$(jq -r '.active_task' "$STATE_FILE")
    FILES=$(jq -r '.recent_files | join(", ")' "$STATE_FILE")

    echo "[codescout-companion] Context restored after compaction:" >&2
    echo "  Branch: $BRANCH" >&2
    [ -n "$TASK" ] && echo "  Task: $TASK" >&2
    [ -n "$FILES" ] && echo "  Recent files: $FILES" >&2
    echo "  Tip: run project_status() or memory(action='read') to reload full context" >&2

    rm -f "$STATE_FILE"
fi

echo "$INPUT"
```

### Integration with codescout

The PostCompact hook should also hint the agent to call `memory(action="read")` and
`project_status()` to fully restore codescout context. If the corrections store (see
codescout design spec) is implemented, also load recent corrections.

## Feature 2: Drift Detection

### Problem

During long sessions, work can gradually drift from the original intent — a bug fix
turns into a refactor, a refactor turns into a feature. The agent doesn't notice because
each step feels locally reasonable.

### Design

**`SessionStart` hook addition — intent capture:**

Extend the existing `session-start.sh` to save the first user prompt's key terms:

```bash
# In session-start.sh, after existing logic
STATE_DIR="${TMPDIR:-/tmp}/codescout-companion"
mkdir -p "$STATE_DIR"

# Extract the user's initial prompt from hook input and save keywords
# (the SessionStart hook receives conversation context)
echo "" > "$STATE_DIR/intent.txt"  # Placeholder — populated by first user message
echo "0" > "$STATE_DIR/edit-count.txt"
```

**`PostToolUse` hook (`hooks/drift-check.sh`) — triggered after edit tools:**

```bash
#!/usr/bin/env bash
# Hook: PostToolUse (on edit_file, replace_symbol, insert_code, create_file)

STATE_DIR="${TMPDIR:-/tmp}/codescout-companion"
INPUT=$(cat)

# Increment edit counter
COUNT_FILE="$STATE_DIR/edit-count.txt"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNT_FILE"

# Only check drift every 8 edits
if [ $((COUNT % 8)) -ne 0 ]; then
    echo "$INPUT"
    exit 0
fi

INTENT=$(cat "$STATE_DIR/intent.txt" 2>/dev/null)
if [ -z "$INTENT" ]; then
    echo "$INPUT"
    exit 0
fi

echo "[codescout-companion] $COUNT edits so far. Original task: \"$INTENT\"" >&2
echo "  If work has drifted, consider committing current progress and refocusing." >&2

echo "$INPUT"
```

### Approach: Keyword vs. Semantic

Pro-workflow uses keyword overlap (stopword removal + top-5 term intersection). This is
cheap and fast but misses synonyms and rephrased intent.

**Recommended approach for codescout-companion:**

Start with the simple keyword approach (no dependencies, runs in bash). If codescout's
embedding pipeline is active, a future version could call `semantic_search` on the
original intent to check relevance of recent edits — but that adds tool-call overhead
to every drift check, so keep it optional.

### Intent Capture

The tricky part: how to capture the user's original intent.

Options:
1. **Manual:** User runs `/focus "fix the auth bug"` at session start (explicit, reliable)
2. **Automatic via `Stop` hook:** On the first assistant response, extract a one-line
   summary and save it (implicit, but parsing assistant output is fragile)
3. **Piggyback on codescout:** If the agent calls `onboarding()` or `project_status()`,
   we could add a `task` parameter that gets saved

**Recommendation:** Start with option 1 (a `/focus` command in the companion plugin).
Simple, no parsing ambiguity, user controls the intent statement.

## Feature 3: Permission Denial Tracking

### Problem

When the companion plugin blocks a native Read/Grep/Glob call (redirecting to codescout
tools), or when the user denies a tool permission, the denial is ephemeral — it's visible
in the session but not tracked. Over time, patterns emerge (e.g., "agents always try
native Grep first on `.rs` files") that could inform plugin tuning.

### Design

**`PermissionDenied` hook (`hooks/denial-tracker.sh`):**

```bash
#!/usr/bin/env bash
# Hook: PermissionDenied

STATE_DIR="${TMPDIR:-/tmp}/codescout-companion"
DENIALS_FILE="$STATE_DIR/denials.jsonl"

INPUT=$(cat)

# Append denial record
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"tool\":\"$TOOL\",\"at\":\"$TIMESTAMP\"}" >> "$DENIALS_FILE"

# Count total denials
TOTAL=$(wc -l < "$DENIALS_FILE" 2>/dev/null || echo 0)

# Surface patterns every 10 denials
if [ $((TOTAL % 10)) -eq 0 ] && [ "$TOTAL" -gt 0 ]; then
    echo "[codescout-companion] $TOTAL tool denials this session. Top denied tools:" >&2
    jq -r '.tool' "$DENIALS_FILE" | sort | uniq -c | sort -rn | head -5 | \
        while read count tool; do
            echo "  $tool: $count" >&2
        done
    echo "  Consider adjusting permissions in settings.json or .claude/settings.json" >&2
fi

echo "$INPUT"
```

**`PreToolUse` hook enhancement — track redirections:**

The existing `semantic-tool-router.sh` already blocks native tools. Add a counter
for redirections (distinct from permission denials) to the same JSONL file:

```bash
# After blocking a native Read/Grep/Glob, append:
echo "{\"tool\":\"$TOOL\",\"type\":\"redirect\",\"at\":\"$TIMESTAMP\"}" >> "$DENIALS_FILE"
```

This separates user-denied permissions from plugin-enforced redirections, enabling
different analysis for each.

## Hook Registration

Add to `hooks/hooks.json`:

```json
{
  "hooks": [
    {
      "event": "PreCompact",
      "command": "bash hooks/compact-save.sh",
      "description": "Save session state before context compaction"
    },
    {
      "event": "PostCompact",
      "command": "bash hooks/compact-restore.sh",
      "description": "Restore session state after context compaction"
    },
    {
      "event": "PostToolUse",
      "command": "bash hooks/drift-check.sh",
      "match_tool": "mcp__codescout__(edit_file|replace_symbol|insert_code|create_file)",
      "description": "Check for task drift after every 8 edits"
    },
    {
      "event": "PermissionDenied",
      "command": "bash hooks/denial-tracker.sh",
      "description": "Track permission denials for pattern analysis"
    }
  ]
}
```

## Implementation Order

1. **Compact guard** (highest value, simplest) — two hooks, no dependencies
2. **Drift detection** — `/focus` command + PostToolUse hook
3. **Permission denial tracking** — single hook + JSONL accumulator

## Open Questions

1. **Compact guard scope:** Should we also save/restore codescout-specific state like
   the active project path, LSP status, or index status? Or trust that the agent will
   re-call `activate_project` after compaction?

2. **Drift check frequency:** Pro-workflow checks after 6 edits. We proposed 8. The
   right number depends on typical session length — should this be configurable in
   `.claude/codescout-companion.json`?

3. **Cross-session denial analytics:** Currently denials are per-session (temp files).
   Worth persisting to a file in `.codescout/` for cross-session analysis? Or is that
   scope creep?

4. **PreCompact/PostCompact availability:** These hook events may not be available in
   all Claude Code versions. Need to verify support and gracefully degrade if missing.
