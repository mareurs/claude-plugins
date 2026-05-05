#!/bin/bash
# SessionStart hook — inject code-explorer tool guidance into main agent
# No-op if code-explorer is not configured for this project.

if ! command -v jq &>/dev/null; then
  echo 'codescout-companion: jq is not installed — all hooks are non-functional. Install with: sudo apt install jq (Debian/Ubuntu) or brew install jq (macOS)'
  exit 0
fi

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SOURCE=$(echo "$INPUT" | jq -r '.source // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODESCOUT" = "false" ] && exit 0

# --- Write CC session ID for usage.db correlation ---
if [ -n "$SESSION_ID" ] && [ -n "$CS_PROJECT_DIR" ]; then
  mkdir -p "$CS_PROJECT_DIR" 2>/dev/null
  printf '%s' "$SESSION_ID" > "$CS_PROJECT_DIR/cc_session_id"
fi

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

MSG=""

# --- Onboarding check ---
if [ "$HAS_CS_ONBOARDING" = "false" ]; then
  MSG="codescout: Project not yet onboarded.
Run the onboarding() tool first — it detects languages, creates project config,
and generates exploration memories that help every subsequent session.

"
fi

# --- Memory hint ---
if [ "$HAS_CS_MEMORIES" = "true" ]; then
  MSG="${MSG}codescout MEMORIES: ${CS_MEMORY_NAMES}
→ Read relevant memories before exploring code (read_memory(\"architecture\"), etc.)

"
fi

# --- System prompt injection ---
if [ "$HAS_CS_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}${CS_SYSTEM_PROMPT}

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

DB_PATH="${CS_PROJECT_DIR}/embeddings.db"

# --- Auto-reindex (if stale) ---
if [ "$AUTO_INDEX" = "true" ] && [ "$IN_WORKTREE" = "false" ] && \
   [ -f "$DB_PATH" ] && [ -n "$CS_BINARY" ] && [ -x "$CS_BINARY" ]; then
  LAST_COMMIT=$(sqlite3 "$DB_PATH" "SELECT value FROM meta WHERE key='last_indexed_commit';" 2>/dev/null)
  HEAD_COMMIT=$(git -C "$CWD" rev-parse HEAD 2>/dev/null)
  if [ -n "$LAST_COMMIT" ] && [ -n "$HEAD_COMMIT" ] && [ "$LAST_COMMIT" != "$HEAD_COMMIT" ]; then
    BEHIND=$(git -C "$CWD" rev-list --count "${LAST_COMMIT}..${HEAD_COMMIT}" 2>/dev/null || echo "?")
    "$CS_BINARY" index --project "$CWD" >/dev/null 2>&1 &
    MSG="${MSG}INDEX: Refreshing in background (${BEHIND} commits behind HEAD) — semantic_search works now, results improve as index updates.

"
  fi
fi

# --- Drift warnings ---
if [ "$DRIFT_WARNINGS" = "true" ] && [ -f "$DB_PATH" ]; then
  if grep -q 'drift_detection_enabled = true' "$CS_CONFIG_FILE" 2>/dev/null; then
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
      MEM_NAMES=$(find "${CS_MEMORIES_DIR}/" -maxdepth 1 -name '*.md' \
        -exec basename {} .md \; 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
      if [ -n "$MEM_NAMES" ]; then
        MSG="${MSG}→ Memories may need updating: ${MEM_NAMES}

"
      fi
    fi
  fi
fi

# --- GitHub identity + repo context ---
# Detect GitHub auth and owner/repo from git remote so github_* tools have context ready.
# Uses gh auth status (local, no network) and parses the git remote URL.
if command -v gh &>/dev/null; then
  GH_USER=$(gh auth status 2>&1 | grep -oP 'Logged in to github\.com account \K\S+' | head -1)
  if [ -z "$GH_USER" ]; then
    # Newer gh versions use a different format
    GH_USER=$(gh auth status 2>&1 | grep -oP 'Logged in to github\.com as \K\S+' | head -1)
  fi
  if [ -n "$GH_USER" ]; then
    REMOTE_URL=$(git -C "$CWD" remote get-url origin 2>/dev/null)
    GH_OWNER=""
    GH_REPO=""
    if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
      GH_OWNER="${BASH_REMATCH[1]}"
      GH_REPO="${BASH_REMATCH[2]%.git}"
    fi
    if [ -n "$GH_OWNER" ] && [ -n "$GH_REPO" ]; then
      MSG="${MSG}GitHub: @${GH_USER} | repo: ${GH_OWNER}/${GH_REPO}
→ For issues/PRs/repo ops, use codescout github_issue/github_pr/github_repo tools with owner=\"${GH_OWNER}\" repo=\"${GH_REPO}\".

"
    else
      MSG="${MSG}GitHub: @${GH_USER} (no GitHub remote detected on origin)

"
    fi
  fi
fi

# --- Connectivity note ---
# Hooks can't verify MCP handshake — detection is config-based only.
# If the MCP server failed to connect, tools won't be available despite config existing.
MSG="${MSG}codescout: Detected in config (${CS_SERVER_NAME}).
Tools load automatically — no ToolSearch or setup step needed.
If tools are unavailable, the MCP server failed to connect (check \`claude mcp list\`).

"


# --- Post-compact LSP flush ---
if [ "$SOURCE" = "compact" ]; then
  MSG="${MSG}POST-COMPACT: Context was just compacted.
→ Call workspace({\"post_compact\": true}) as your FIRST action to flush stale LSP position caches.
   LSP clients restart lazily — no disruption to the session.

"
fi

# --- Worktree reminder (session resumed inside a worktree) ---
if [ "$IN_WORKTREE" = "true" ]; then
  WT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)

  # Ensure .codescout/ (or .code-explorer/) symlink exists — worktree-activate.sh creates it via
  # PostToolUse on EnterWorktree, but a resumed or directly-opened session skips that.
  MAIN_GIT=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
  MAIN_ROOT=$(dirname "$MAIN_GIT")
  if [ -n "$MAIN_ROOT" ] && [ "$MAIN_ROOT" != "." ]; then
    # Use .codescout if it exists on the main project, else .code-explorer (backwards compat)
    if [ -d "$MAIN_ROOT/.codescout" ]; then
      CE_NAME=".codescout"
    else
      CE_NAME=".code-explorer"
    fi
    CE_DEST="${WT_ROOT:-$CWD}/${CE_NAME}"
    if [ ! -e "$CE_DEST" ]; then
      # Create main project dir if it doesn't exist yet (server writes project.toml on first run)
      mkdir -p "$MAIN_ROOT/${CE_NAME}" 2>/dev/null
      ln -s "$MAIN_ROOT/${CE_NAME}" "$CE_DEST" 2>/dev/null
    fi
    # Fallback: worktree has a real .codescout dir — symlink individual shared assets
    if [ -d "$CE_DEST" ] && [ ! -L "$CE_DEST" ]; then
      for ASSET in embeddings; do
        SRC="$MAIN_ROOT/${CE_NAME}/${ASSET}"
        DST="${CE_DEST}/${ASSET}"
        [ -e "$SRC" ] || continue
        if [ -e "$DST" ] || [ -L "$DST" ]; then continue; fi
        ln -s "$SRC" "$DST" 2>/dev/null
      done
    fi
  fi

  MSG="${MSG}WORKTREE SESSION: You are inside a git worktree at: ${WT_ROOT:-$CWD}
→ Call workspace(\"${WT_ROOT:-$CWD}\") before using any codescout write tools.
→ Memory writes go directly to the main project via symlink and can be committed there.

"
fi

# --- Iron Laws reminder (survives context compression) ---
MSG="${MSG}CODESCOUT RULES (compression-resilient reminder):
• Source code: symbols (list + find), NOT read_file/Read
• Code edits: replace_symbol/insert_code/remove_symbol, NOT edit_file/Edit for structural changes
• Shell commands: run_command, NOT Bash — output buffers save tokens
• Markdown: read_markdown/edit_markdown, NOT read_file/edit_file
• Never pipe run_command output — query @ref buffers instead

"

# --- Tool guide ---
MSG="${MSG}NEVER USE BASH AGENTS FOR CODE WORK.
Bash agents have no codescout tools. Use general-purpose, Plan, or Explore
agents for any task involving code reading, writing, or navigation."

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
