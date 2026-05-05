# Hook Block Message Deduplication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When multiple parallel tool calls are all blocked by `pre-tool-guard.sh`, show the full block message only once — subsequent calls in the same batch get `"BLOCKED (see previous message)"`.

**Architecture:** Modify the `enforce()` helper in `pre-tool-guard.sh` to use `noclobber`-based atomic file creation as a dedup gate. First writer in a 3-second window gets the full message; all others get the short reason. Dedup key is `TOOL_NAME + CWD` so parallel `Read` + `Bash` blocks each show their own message once.

**Tech Stack:** Bash, `jq`, `md5sum` (coreutils). No new dependencies.

---

### Task 1: Write failing tests for dedup behavior

**Files:**
- Modify: `tests/test-pre-tool-guard.sh`

- [ ] **Step 1: Append dedup tests to the test file**

Add after the last existing test (Test 16, line 143, before `print_summary`):

```bash
# Test 17: parallel dedup — first call gets full reason
OUT1=$(guard_input "Bash" '"command":"cat foo.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT1" && assert_reason_contains "$OUT1" "run_command"; then
  pass "Bash dedup: first call gets full reason"
else
  fail "Bash dedup: first call gets full reason" "$OUT1"
fi

# Test 18: parallel dedup — second call within window gets short reason
OUT2=$(guard_input "Bash" '"command":"cat bar.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT2" && assert_reason_contains "$OUT2" "see previous message"; then
  pass "Bash dedup: second call gets short reason"
else
  fail "Bash dedup: second call gets short reason" "$OUT2"
fi

# Test 19: different tool type in same window gets its own full reason
OUT3=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT3" && assert_reason_contains "$OUT3" "list_symbols"; then
  pass "Read dedup: different tool type gets full reason"
else
  fail "Read dedup: different tool type gets full reason" "$OUT3"
fi

# Test 20: after dedup window cleared, full reason again
DEDUP_KEY=$(printf '%s\t%s' "Bash" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$DEDUP_KEY"
OUT4=$(guard_input "Bash" '"command":"cat baz.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT4" && assert_reason_contains "$OUT4" "run_command"; then
  pass "Bash dedup: after window cleared, full reason again"
else
  fail "Bash dedup: after window cleared, full reason again" "$OUT4"
fi
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/marius/work/claude/claude-plugins
bash tests/test-pre-tool-guard.sh 2>&1 | tail -20
```

Expected: Tests 17–20 fail. Tests 18 and 20 will fail because dedup logic doesn't exist yet — currently every call returns the full reason.

---

### Task 2: Implement dedup in `enforce()`

**Files:**
- Modify: `codescout-companion/hooks/pre-tool-guard.sh`

The current `enforce()` (lines 24–34):

```bash
# --- Helper: hard-block with reason shown to Claude ---
enforce() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}
```

- [ ] **Step 1: Replace `enforce()` with the dedup-aware version**

Replace the entire function (lines 24–34) with:

```bash
# --- Helper: hard-block with reason shown to Claude ---
# First blocked call in a 3-second window per (TOOL_NAME, CWD) gets the full reason.
# Subsequent parallel calls get a short "see previous message" to avoid noise.
enforce() {
  local reason="$1"
  local dedup_key
  dedup_key=$(printf '%s\t%s' "$TOOL_NAME" "$CWD" | md5sum | cut -c1-8)
  local dedup_file="/tmp/cs-block-$dedup_key"
  if ! ( set -o noclobber; : > "$dedup_file" ) 2>/dev/null; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED (see previous message)"
      }
    }'
    exit 0
  fi
  ( sleep 3; rm -f "$dedup_file" ) &
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}
```

- [ ] **Step 2: Run tests to confirm all pass**

```bash
cd /home/marius/work/claude/claude-plugins
bash tests/test-pre-tool-guard.sh 2>&1
```

Expected: all tests pass including Tests 17–20.

- [ ] **Step 3: Run full suite to confirm no regressions**

```bash
bash tests/run-all.sh 2>&1
```

Expected: `✓ All suites passed.`

- [ ] **Step 4: Commit**

```bash
cd /home/marius/work/claude/claude-plugins
git add codescout-companion/hooks/pre-tool-guard.sh tests/test-pre-tool-guard.sh
git commit -m "fix(pre-tool-guard): deduplicate block messages for parallel tool calls

When N parallel calls are blocked simultaneously, only the first shows the
full guidance message. Subsequent calls within a 3-second window return
\"BLOCKED (see previous message)\" to avoid context noise.

Uses noclobber-based atomic file creation (O_EXCL) — no race condition.
Dedup key: TOOL_NAME + CWD (per tool type per project).
"
```

---

### Task 3: Deploy to both Claude Code instances

**Files:**
- Deploy: `~/.claude/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh`
- Deploy: `~/.claude-sdd/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh`

Both instances have cached copies of the hook. Source edits in `claude-plugins/` are not picked up automatically — must copy to both caches.

- [ ] **Step 1: Copy updated hook to both cache locations**

```bash
SRC="/home/marius/work/claude/claude-plugins/codescout-companion/hooks/pre-tool-guard.sh"
cp "$SRC" "/home/marius/.claude/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh"
cp "$SRC" "/home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh"
echo "Deployed to both instances"
```

Expected: no error output.

- [ ] **Step 2: Verify deployed copies match source**

```bash
diff "$SRC" "/home/marius/.claude/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh" && \
diff "$SRC" "/home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/codescout-companion/1.8.8/hooks/pre-tool-guard.sh" && \
echo "Both instances in sync"
```

Expected: `Both instances in sync` with no diff output.

- [ ] **Step 3: Start a new Claude Code session and verify**

Manually trigger a parallel violation (e.g., two parallel `Read` calls on source files in code-explorer). Confirm:
- First blocked call shows full `"WRONG TOOL. You called Read..."` message
- Second blocked call shows `"BLOCKED (see previous message)"`
