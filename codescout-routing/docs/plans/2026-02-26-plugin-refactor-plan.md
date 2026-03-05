# Plugin Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor code-explorer-routing plugin for single-source guidance, workspace-scoped blocking, specific redirect messages, and a new edit-router hook.

**Architecture:** Extract guidance into `guidance.txt`, add config for `workspace_root` and `block_reads` in `detect-tools.sh`, generate specific redirect messages in `semantic-tool-router.sh`, and add `edit-router.sh` for blocking `replace_content` on source files.

**Tech Stack:** Bash, jq. All files in `/home/marius/work/claude/claude-plugins/code-explorer-routing/hooks/`.

**Design doc:** `docs/plans/2026-02-26-plugin-refactor-design.md`

---

### Task 1: Create `guidance.txt` — single-source guidance content

**Files:**
- Create: `hooks/guidance.txt`

**Step 1: Create the guidance file**

```
CODE-EXPLORER: Read → Navigate → Edit. Never skip steps.

READ code:
  get_symbols_overview(file)  → see structure + line numbers
  find_symbol(name, include_body=true) → read one symbol
  NEVER read_file without start_line + end_line from a prior overview.

FIND code:
  Know the name  → find_symbol(pattern)
  Know a concept → semantic_search("query")
  Need callers   → find_referencing_symbols(name_path, file)
  Need regex     → search_for_pattern(pattern)

EDIT code:
  Symbol-level (preferred) → replace_symbol_body / insert_before_symbol / insert_after_symbol
  Line-level (know lines)  → edit_lines(path, start_line, delete_count, new_text)
  Text find-replace (non-code only) → replace_content(path, old, new)

RULES:
  1. Structure before content — get_symbols_overview ALWAYS before reading
  2. Symbol tools for code edits — never replace_content on source files
  3. Grep/Glob/Read are for .md .json .toml .yaml only — code-explorer for source
```

**Step 2: Verify**

Run: `cat hooks/guidance.txt | wc -l`
Expected: ~20 lines

**Step 3: Commit**

```bash
git add hooks/guidance.txt
git commit -m "feat(routing): add single-source guidance.txt"
```

---

### Task 2: Update `detect-tools.sh` — add config for workspace_root and block_reads

**Files:**
- Modify: `hooks/detect-tools.sh`

**Step 1: Add config reading after the existing detection logic**

After the `SOURCE_EXT_PATTERN` line at the end of the file, the file currently ends. Add config reading from `.claude/code-explorer-routing.json` for the new fields. Also read the config file earlier where `ROUTING_CONFIG` is defined — it's already read for `server_name`, extend it.

After the existing config reading block (around line 20-27 where `_override` is read), add:

```bash
# Read routing config for blocking behavior
BLOCK_READS=true
WORKSPACE_ROOT=""

if [ -f "$ROUTING_CONFIG" ]; then
  _block=$(jq -r '.block_reads // empty' "$ROUTING_CONFIG" 2>/dev/null)
  [ "$_block" = "false" ] && BLOCK_READS=false
  _ws=$(jq -r '.workspace_root // empty' "$ROUTING_CONFIG" 2>/dev/null)
  if [ -n "$_ws" ]; then
    # Expand ~ to $HOME
    WORKSPACE_ROOT="${_ws/#\~/$HOME}"
  fi
fi
```

Place this block AFTER the existing `if [ -f "$ROUTING_CONFIG" ]` block (don't merge them — keep the server_name detection separate from blocking config). Put it right before the `# --- Onboarding state ---` comment.

**Step 2: Verify detection script still works**

Run: `CWD=/home/marius/work/claude/code-explorer source hooks/detect-tools.sh && echo "CE=$HAS_CODE_EXPLORER BLOCK=$BLOCK_READS WS=$WORKSPACE_ROOT"`
Expected: `CE=true BLOCK=true WS=` (empty workspace since no config yet)

**Step 3: Test with a config file**

Run:
```bash
mkdir -p /tmp/test-routing/.claude
echo '{"workspace_root": "~/work", "block_reads": true}' > /tmp/test-routing/.claude/code-explorer-routing.json
CWD=/tmp/test-routing source hooks/detect-tools.sh && echo "BLOCK=$BLOCK_READS WS=$WORKSPACE_ROOT"
```
Expected: `BLOCK=true WS=/home/marius/work`

Run:
```bash
echo '{"block_reads": false}' > /tmp/test-routing/.claude/code-explorer-routing.json
CWD=/tmp/test-routing source hooks/detect-tools.sh && echo "BLOCK=$BLOCK_READS"
```
Expected: `BLOCK=false`

Clean up: `rm -rf /tmp/test-routing`

**Step 4: Commit**

```bash
git add hooks/detect-tools.sh
git commit -m "feat(routing): add workspace_root and block_reads config to detect-tools"
```

---

### Task 3: Rewrite `session-start.sh` — use guidance.txt

**Files:**
- Modify: `hooks/session-start.sh`

**Step 1: Rewrite the script**

Replace the entire `MSG` construction (the ~80 line tool guide) with reading from `guidance.txt`. Keep the onboarding check and memory hint preamble — those are dynamic and should stay.

The new script should:
1. Source `detect-tools.sh` (unchanged)
2. Exit if no code-explorer (unchanged)
3. Build `MSG` with onboarding hint if needed (unchanged logic, same text)
4. Build `MSG` with memory hint if needed (unchanged logic, same text)
5. Read `guidance.txt` and append it to `MSG` (replaces the hardcoded guide)
6. Append the "NEVER USE BASH AGENTS" warning (keep this — it's behavioral, not a tool reference)
7. Output JSON (unchanged)

The full new script:

```bash
#!/bin/bash
# SessionStart hook — inject code-explorer tool guidance into main agent
# No-op if code-explorer is not configured for this project.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

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
```

**Step 2: Verify output**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer"}' | bash hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | head -5`
Expected: Should start with `CODE-EXPLORER MEMORIES:` or `CODE-EXPLORER: Read →` depending on onboarding/memory state.

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer"}' | bash hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | grep "edit_lines"`
Expected: Should find the `edit_lines` line from guidance.txt.

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer"}' | bash hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | wc -l`
Expected: ~30-35 lines (preamble + 20 lines guidance + bash agents warning).

**Step 3: Commit**

```bash
git add hooks/session-start.sh
git commit -m "refactor(routing): session-start reads from guidance.txt"
```

---

### Task 4: Rewrite `subagent-guidance.sh` — same guidance for all agents

**Files:**
- Modify: `hooks/subagent-guidance.sh`

**Step 1: Rewrite the script**

Remove the Plan vs compact split. All code-capable agents get the same `guidance.txt` content. Keep the agent-type skip list.

```bash
#!/bin/bash
# SubagentStart hook — inject code-explorer guidance into all subagents
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

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

GUIDANCE=$(cat "$(dirname "$0")/guidance.txt")

jq -n --arg ctx "$GUIDANCE" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
```

**Step 2: Verify output**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","agent_type":"general-purpose"}' | bash hooks/subagent-guidance.sh | jq -r '.hookSpecificOutput.additionalContext' | head -3`
Expected: `CODE-EXPLORER: Read → Navigate → Edit. Never skip steps.`

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","agent_type":"Bash"}' | bash hooks/subagent-guidance.sh`
Expected: Empty output (Bash agents skipped).

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","agent_type":"Plan"}' | bash hooks/subagent-guidance.sh | jq -r '.hookSpecificOutput.additionalContext' | grep "edit_lines"`
Expected: Should find `edit_lines` — Plan agents now get the same guidance as everyone else.

**Step 3: Commit**

```bash
git add hooks/subagent-guidance.sh
git commit -m "refactor(routing): subagent-guidance reads from guidance.txt, same for all agents"
```

---

### Task 5: Rewrite `semantic-tool-router.sh` — workspace scope + specific redirects

**Files:**
- Modify: `hooks/semantic-tool-router.sh`

**Step 1: Rewrite the script**

Major changes:
- Add workspace scope check using `WORKSPACE_ROOT` and `BLOCK_READS` from detect-tools
- Generate specific redirect messages that include the actual path/pattern from the blocked call
- Keep the existing pass-through logic for targeted reads (limit/offset) and broad globs

```bash
#!/bin/bash
# PreToolUse hook — redirect Grep/Glob/Read on source files to code-explorer tools
# Pass-through for non-code files, files outside workspace, and when blocking is disabled.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0
[ "$BLOCK_READS" = "false" ] && exit 0

# --- Helper: check if path is under workspace ---
is_in_workspace() {
  local file_path="$1"
  # No workspace configured = block everything (original behavior)
  [ -z "$WORKSPACE_ROOT" ] && return 0
  # Make path absolute if relative
  if [[ "$file_path" != /* ]]; then
    file_path="${CWD}/${file_path}"
  fi
  # Check if under workspace root
  [[ "$file_path" == "${WORKSPACE_ROOT}"* ]]
}

# --- Helper: emit deny response ---
deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$TOOL_NAME" in
  Grep)
    GLOB=$(echo "$INPUT" | jq -r '.tool_input.glob // empty')
    PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
    TYPE=$(echo "$INPUT" | jq -r '.tool_input.type // empty')
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    IS_SOURCE=false
    case "$TYPE" in
      kotlin|kt|kts|java|ts|typescript|js|javascript|py|python|go|rust|cs|csharp|rb|ruby|scala|swift|cpp|c)
        IS_SOURCE=true ;;
    esac

    if [ "$IS_SOURCE" = "false" ]; then
      echo "$GLOB" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
      echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" && IS_SOURCE=true
    fi

    [ "$IS_SOURCE" = "false" ] && exit 0
    is_in_workspace "${PATH_VAL:-$CWD}" || exit 0

    deny "BLOCKED: Use code-explorer for source file search:
  search_for_pattern(\"${PATTERN}\")  — regex across source files
  find_symbol(\"${PATTERN}\")         — find symbol by name
  semantic_search(\"${PATTERN}\")     — find code by meaning"
    ;;

  Glob)
    PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // empty')

    echo "$PATTERN" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    BASENAME="${PATTERN##*/}"

    # Allow broad wildcard scans (e.g. **/*.ts for discovery)
    if [[ "$BASENAME" == "*."* ]]; then
      exit 0
    fi

    is_in_workspace "${PATTERN}" || exit 0

    # Block specific named file lookups
    if [[ "$BASENAME" =~ ^[A-Z] ]] || [[ "$BASENAME" != "*"* ]]; then
      deny "BLOCKED: Use code-explorer for source file discovery:
  find_file(\"${PATTERN}\")           — glob file discovery
  find_symbol(\"${BASENAME%.*}\")     — find symbol by name"
    fi
    ;;

  Read)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    LIMIT=$(echo "$INPUT" | jq -r '.tool_input.limit // empty')
    OFFSET=$(echo "$INPUT" | jq -r '.tool_input.offset // empty')

    echo "$FILE_PATH" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

    # Allow targeted reads (explicit limit or offset = intentional)
    [ -n "$LIMIT" ] || [ -n "$OFFSET" ] && exit 0

    is_in_workspace "$FILE_PATH" || exit 0

    # Extract just the relative path for the suggestion
    REL_PATH="$FILE_PATH"
    if [[ "$FILE_PATH" == "$CWD"* ]]; then
      REL_PATH="${FILE_PATH#$CWD/}"
    fi

    deny "BLOCKED: Use structure discovery instead of reading whole files:
  get_symbols_overview(\"${REL_PATH}\")          — see all symbols + line numbers
  find_symbol(name, include_body=true)           — read a specific symbol body
  list_functions(\"${REL_PATH}\")                — fast offline function list"
    ;;
esac

exit 0
```

**Step 2: Verify — source file inside workspace is blocked**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Read","tool_input":{"file_path":"/home/marius/work/claude/code-explorer/src/server.rs"}}' | bash hooks/semantic-tool-router.sh | jq -r '.hookSpecificOutput.permissionDecisionReason' | head -1`
Expected: `BLOCKED: Use structure discovery instead of reading whole files:`

**Step 3: Verify — source file outside workspace passes through**

First create a config with workspace_root:
```bash
mkdir -p /home/marius/work/claude/code-explorer/.claude
echo '{"workspace_root": "~/work/claude/code-explorer"}' > /home/marius/work/claude/code-explorer/.claude/code-explorer-routing.json
```

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Read","tool_input":{"file_path":"/home/marius/work/claude/claude-plugins/code-explorer-routing/hooks/session-start.sh"}}' | bash hooks/semantic-tool-router.sh`
Expected: Empty output (file is outside workspace, passes through).

Clean up the test config: `rm /home/marius/work/claude/code-explorer/.claude/code-explorer-routing.json`

**Step 4: Verify — targeted read passes through**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Read","tool_input":{"file_path":"src/server.rs","limit":20,"offset":100}}' | bash hooks/semantic-tool-router.sh`
Expected: Empty output (targeted read, passes through).

**Step 5: Verify — non-source file passes through**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Read","tool_input":{"file_path":"README.md"}}' | bash hooks/semantic-tool-router.sh`
Expected: Empty output (not a source file).

**Step 6: Verify — block_reads=false disables all blocking**

```bash
mkdir -p /tmp/test-routing/.claude
echo '{"block_reads": false}' > /tmp/test-routing/.claude/code-explorer-routing.json
echo '{"cwd":"/tmp/test-routing","tool_name":"Read","tool_input":{"file_path":"src/main.rs"}}' | bash hooks/semantic-tool-router.sh
```
Expected: Empty output (blocking disabled).
Clean up: `rm -rf /tmp/test-routing`

**Step 7: Commit**

```bash
git add hooks/semantic-tool-router.sh
git commit -m "feat(routing): workspace-scoped blocking with specific redirect messages"
```

---

### Task 6: Create `edit-router.sh` — block replace_content on source files

**Files:**
- Create: `hooks/edit-router.sh`

**Step 1: Create the script**

```bash
#!/bin/bash
# PreToolUse hook — redirect replace_content on source files to edit_lines or symbol tools
# Only blocks when the tool belongs to the code-explorer MCP server.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# Only block code-explorer's replace_content, not other tools matching the substring
EXPECTED_TOOL="mcp__${CE_SERVER_NAME}__replace_content"
[ "$TOOL_NAME" != "$EXPECTED_TOOL" ] && exit 0

# Check if target is a source file
PATH_VAL=$(echo "$INPUT" | jq -r '.tool_input.path // empty')
echo "$PATH_VAL" | grep -qiE "$SOURCE_EXT_PATTERN" || exit 0

# Extract relative path for suggestion
REL_PATH="$PATH_VAL"
if [[ "$PATH_VAL" == "$CWD"* ]]; then
  REL_PATH="${PATH_VAL#$CWD/}"
fi

jq -n --arg reason "BLOCKED: For code files, use symbol-aware or line-based editing:
  replace_symbol_body(name_path, \"${REL_PATH}\", new_body) — replace entire symbol
  edit_lines(\"${REL_PATH}\", start_line, delete_count, new_text) — splice by line number
  insert_before_symbol / insert_after_symbol — add code at symbol boundaries

replace_content is for non-code files (.md, .json, .toml, .yaml) only." '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
```

**Step 2: Make executable**

Run: `chmod +x hooks/edit-router.sh`

**Step 3: Verify — blocks replace_content on source file**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"mcp__code-explorer__replace_content","tool_input":{"path":"src/server.rs","old":"foo","new":"bar"}}' | bash hooks/edit-router.sh | jq -r '.hookSpecificOutput.permissionDecisionReason' | head -1`
Expected: `BLOCKED: For code files, use symbol-aware or line-based editing:`

**Step 4: Verify — passes through for non-source file**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"mcp__code-explorer__replace_content","tool_input":{"path":"README.md","old":"foo","new":"bar"}}' | bash hooks/edit-router.sh`
Expected: Empty output (not a source file).

**Step 5: Verify — passes through for non-code-explorer tool**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Edit","tool_input":{"path":"src/server.rs"}}' | bash hooks/edit-router.sh`
Expected: Empty output (not the code-explorer MCP tool).

**Step 6: Commit**

```bash
git add hooks/edit-router.sh
git commit -m "feat(routing): add edit-router hook blocking replace_content on source files"
```

---

### Task 7: Update `hooks.json` — register edit-router

**Files:**
- Modify: `hooks/hooks.json`

**Step 1: Add the replace_content matcher**

Replace the entire `hooks.json` with:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-guidance.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Glob|Read",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/semantic-tool-router.sh"
          }
        ]
      },
      {
        "matcher": "replace_content",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/edit-router.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Verify valid JSON**

Run: `jq . hooks/hooks.json`
Expected: Pretty-printed JSON without errors.

**Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(routing): register edit-router in hooks.json"
```

---

### Task 8: Final verification

**Step 1: Verify all scripts are executable**

Run: `ls -la hooks/*.sh`
Expected: All `.sh` files have execute permission.

If any missing: `chmod +x hooks/*.sh`

**Step 2: End-to-end test — session start**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer"}' | bash hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext'`
Expected: Onboarding/memory preamble + guidance from `guidance.txt` + bash agents warning. Should contain `edit_lines`. Should NOT contain the old 80-line tool guide.

**Step 3: End-to-end test — subagent (Plan)**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","agent_type":"Plan"}' | bash hooks/subagent-guidance.sh | jq -r '.hookSpecificOutput.additionalContext'`
Expected: Same ~20 line guidance. No more separate "rich Plan" variant.

**Step 4: End-to-end test — read blocked with specific path**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"Read","tool_input":{"file_path":"src/tools/file.rs"}}' | bash hooks/semantic-tool-router.sh | jq -r '.hookSpecificOutput.permissionDecisionReason'`
Expected: Message includes `get_symbols_overview("src/tools/file.rs")` — the actual path.

**Step 5: End-to-end test — replace_content blocked on source**

Run: `echo '{"cwd":"/home/marius/work/claude/code-explorer","tool_name":"mcp__code-explorer__replace_content","tool_input":{"path":"src/server.rs","old":"x","new":"y"}}' | bash hooks/edit-router.sh | jq -r '.hookSpecificOutput.permissionDecisionReason'`
Expected: Message includes `edit_lines("src/server.rs", ...)` — the actual path.

**Step 6: Verify file count**

Run: `ls hooks/`
Expected: 7 files: `detect-tools.sh`, `edit-router.sh`, `guidance.txt`, `hooks.json`, `semantic-tool-router.sh`, `session-start.sh`, `subagent-guidance.sh`
