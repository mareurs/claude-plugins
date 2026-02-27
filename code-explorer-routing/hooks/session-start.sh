#!/bin/bash
# SessionStart hook — inject code-explorer tool guidance into main agent
# No-op if code-explorer is not configured for this project.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Worktree detection: skip auto-indexing if in a worktree ---
IN_WORKTREE=false
if git -C "$CWD" rev-parse --is-inside-work-tree &>/dev/null; then
  GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
  GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)
  # In a worktree, git-common-dir != git-dir
  if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
    IN_WORKTREE=true
  fi
fi

GUIDANCE=$(cat "$(dirname "$0")/guidance.txt")
MSG=""

# --- Onboarding check ---
if [ "$HAS_CE_ONBOARDING" = "false" ]; then
  MSG="CODE-EXPLORER: Project not yet onboarded.
Run the onboarding() tool first — it detects languages, creates project config,
and generates exploration memories that help every subsequent session.

"
fi

# --- Memory hint ---
if [ "$HAS_CE_MEMORIES" = "true" ]; then
  MSG="${MSG}CODE-EXPLORER MEMORIES: ${CE_MEMORY_NAMES}
→ Read relevant memories before exploring code (read_memory(\"architecture\"), etc.)

"
fi

# --- Auto-reindex config ---
AUTO_INDEX=true
DRIFT_WARNINGS=true
if [ -f "$ROUTING_CONFIG" ]; then
  _ai=$(jq -r '.auto_index // empty' "$ROUTING_CONFIG" 2>/dev/null)
  [ "$_ai" = "false" ] && AUTO_INDEX=false
  _dw=$(jq -r '.drift_warnings // empty' "$ROUTING_CONFIG" 2>/dev/null)
  [ "$_dw" = "false" ] && DRIFT_WARNINGS=false
fi

DB_PATH="${CWD}/.code-explorer/embeddings.db"

# --- Auto-reindex (if stale) ---
if [ "$AUTO_INDEX" = "true" ] && [ "$IN_WORKTREE" = "false" ] && \
   [ -f "$DB_PATH" ] && [ -n "$CE_BINARY" ] && [ -x "$CE_BINARY" ]; then
  LAST_COMMIT=$(sqlite3 "$DB_PATH" "SELECT value FROM meta WHERE key='last_indexed_commit';" 2>/dev/null)
  HEAD_COMMIT=$(git -C "$CWD" rev-parse HEAD 2>/dev/null)
  if [ -n "$LAST_COMMIT" ] && [ -n "$HEAD_COMMIT" ] && [ "$LAST_COMMIT" != "$HEAD_COMMIT" ]; then
    BEHIND=$(git -C "$CWD" rev-list --count "${LAST_COMMIT}..${HEAD_COMMIT}" 2>/dev/null || echo "?")
    if "$CE_BINARY" index --project "$CWD" >/dev/null 2>&1; then
      MSG="${MSG}INDEX: Refreshed (was ${BEHIND} commits behind HEAD).

"
    else
      MSG="${MSG}INDEX: Refresh failed — results may be stale (${BEHIND} commits behind HEAD).

"
    fi
  fi
fi

# --- Drift warnings ---
if [ "$DRIFT_WARNINGS" = "true" ] && [ -f "$DB_PATH" ]; then
  if grep -q 'drift_detection_enabled = true' "${CWD}/.code-explorer/project.toml" 2>/dev/null; then
    DRIFT_FILES=$(sqlite3 "$DB_PATH" \
      "SELECT file_path || ' (drift: ' || printf('%.2f', max_drift) || ')' \
       FROM drift_report WHERE max_drift > 0.1 ORDER BY max_drift DESC LIMIT 10;" 2>/dev/null)
    if [ -n "$DRIFT_FILES" ]; then
      MSG="${MSG}DRIFT WARNING: These files changed significantly since last index:
$(echo "$DRIFT_FILES" | sed 's/^/  /')
"
      if echo "$DRIFT_FILES" | grep -q '^src/tools/'; then
        MSG="${MSG}→ Check if docs/ still matches the tools described.
"
      fi
      if echo "$DRIFT_FILES" | grep -q '^src/'; then
        MSG="${MSG}→ Check if CLAUDE.md and README.md still match these changes.
"
      fi
      MEM_NAMES=$(find "${CWD}/.code-explorer/memories/" -maxdepth 1 -name '*.md' \
        -exec basename {} .md \; 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
      if [ -n "$MEM_NAMES" ]; then
        MSG="${MSG}→ Memories may need updating: ${MEM_NAMES}

"
      fi
    fi
  fi
fi

# --- Tool guide ---
MSG="${MSG}${GUIDANCE}

NEVER USE BASH AGENTS FOR CODE WORK.
Bash agents have no code-explorer tools. Use general-purpose, Plan, or Explore
agents for any task involving code reading, writing, or navigation."

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
