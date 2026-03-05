# Subagent Active Tool Directive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all coding subagents receive an imperative "use code-explorer for ALL code navigation" directive, regardless of whether a project system-prompt.md exists.

**Architecture:** Remove the early-exit guard on `HAS_CE_SYSTEM_PROMPT` in `subagent-guidance.sh`. Always build and emit a message: tool directive first, project system-prompt appended if present.

**Tech Stack:** Bash, jq

---

### Task 1: Modify `subagent-guidance.sh`

**Files:**
- Modify: `code-explorer-routing/hooks/subagent-guidance.sh`

**Step 1: Read the current file**

Open `code-explorer-routing/hooks/subagent-guidance.sh` and confirm you see this block near the bottom:

```bash
# server_instructions from MCP already deliver generic tool guidance to every subagent.
# This hook only needs to inject project-specific content that server_instructions can't carry.
[ "$HAS_CE_SYSTEM_PROMPT" = "false" ] && exit 0

jq -n --arg ctx "$CE_SYSTEM_PROMPT" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
```

**Step 2: Replace that block**

Replace everything from the comment through the closing `}'` with:

```bash
# Always inject an active tool-use directive so coding subagents don't fall back
# to Read/Grep/Glob/Bash on source files. Append project system-prompt if present.
MSG="CODE-EXPLORER: For ALL code navigation, use code-explorer tools — not Read/Grep/Glob/Bash on source files:
  find_symbol / list_symbols / semantic_search — discover code
  goto_definition / find_references — navigate relationships
  replace_symbol / insert_code — edit code"

if [ "$HAS_CE_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}

${CE_SYSTEM_PROMPT}"
fi

jq -n --arg ctx "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
```

**Step 3: Verify the file looks right**

Read the file back and confirm:
- The `[ "$HAS_CE_SYSTEM_PROMPT" = "false" ] && exit 0` line is gone
- The `MSG=` variable is set unconditionally
- System prompt is appended only when `HAS_CE_SYSTEM_PROMPT = true`
- The `jq` output uses `$MSG` not `$CE_SYSTEM_PROMPT`

**Step 4: Test — no system prompt case**

Create a temp project directory without a system-prompt.md and run the hook:

```bash
TMPDIR=$(mktemp -d)
# Simulate code-explorer configured (via routing config)
mkdir -p "$TMPDIR/.claude"
echo '{"server_name":"code-explorer"}' > "$TMPDIR/.claude/code-explorer-routing.json"

echo "{\"cwd\":\"$TMPDIR\",\"agent_type\":\"general-purpose\"}" \
  | bash code-explorer-routing/hooks/subagent-guidance.sh
```

Expected: JSON output containing `"additionalContext"` with the tool directive text (`find_symbol`, `list_symbols`, etc.). Should NOT be empty output or exit 0.

**Step 5: Test — with system prompt case**

```bash
mkdir -p "$TMPDIR/.code-explorer"
echo "## Project: MyApp\nKey entry point: src/main.rs" > "$TMPDIR/.code-explorer/system-prompt.md"

echo "{\"cwd\":\"$TMPDIR\",\"agent_type\":\"superpowers:code-reviewer\"}" \
  | bash code-explorer-routing/hooks/subagent-guidance.sh
```

Expected: JSON output where `additionalContext` contains BOTH the tool directive AND the project system-prompt content.

**Step 6: Test — skip list still works**

```bash
echo "{\"cwd\":\"$TMPDIR\",\"agent_type\":\"Bash\"}" \
  | bash code-explorer-routing/hooks/subagent-guidance.sh
```

Expected: Empty output (exit 0, no JSON). The Bash agent must still be skipped.

**Step 7: Test — no code-explorer configured**

```bash
TMPDIR2=$(mktemp -d)
echo "{\"cwd\":\"$TMPDIR2\",\"agent_type\":\"general-purpose\"}" \
  | bash code-explorer-routing/hooks/subagent-guidance.sh
```

Expected: Empty output (exit 0, no JSON). No code-explorer → no injection.

**Step 8: Commit**

```bash
git add code-explorer-routing/hooks/subagent-guidance.sh
git commit -m "feat(routing): always inject tool directive into coding subagents, v1.5.3"
```

---

### Task 2: Bump version

**Files:**
- Modify: `code-explorer-routing/.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Update plugin.json**

In `code-explorer-routing/.claude-plugin/plugin.json`, bump version from current to next patch (e.g. `1.5.2` → `1.5.3`).

**Step 2: Update README.md version table**

Find the version table in `README.md` and update the `code-explorer-routing` row to match.

**Step 3: Run version check**

```bash
./scripts/check-versions.sh
```

Expected: No errors. All versions consistent.

**Step 4: Commit**

```bash
git add code-explorer-routing/.claude-plugin/plugin.json README.md
git commit -m "chore: bump code-explorer-routing to v1.5.3"
```
