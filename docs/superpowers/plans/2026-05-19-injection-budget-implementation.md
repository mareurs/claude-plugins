# Injection Budget Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the `codescout-companion` SessionStart `additionalContext` payload from ~16 KB (mostly past CC's 2 KB cap) to ~1.5 KB of pointers, and add two new PreToolUse hint hooks that fire just-in-time skill reminders with session-scoped dedup.

**Architecture:** SessionStart emits a small pointer payload referencing the `Skill` tool for content >2 KB; new `pre-task-hint.sh` and `pre-edit-hint.sh` hooks inject one-line skill recommendations on first Agent dispatch / first shape-changing edit per session, using marker files at `.buddy/$SID/hint-emitted-<topic>` for dedup. Mirrors the codescout-side `mcp-prompt-channel-redesign` Surface C pattern in the companion's hooks-only world.

**Tech Stack:** Bash (5+), `jq`, existing `tests/lib/fixtures.sh` harness, `tests/run-all.sh` glob runner.

**Spec:** `docs/superpowers/specs/2026-05-19-injection-budget-design.md`
**Session log:** `docs/trackers/injection-budget-session-log.md` (F-1, F-2, F-3, W-1, W-2)

---

## Pre-flight

Before Task 1, ensure the working tree is clean for `codescout-companion/hooks/session-start.sh`. An earlier exploratory edit in this branch moved the recon-injection block earlier in the script as a partial mitigation; that change is **superseded** by this plan, which removes the verbatim recon body entirely.

- [ ] **Step 1: Check working tree state**

Run:
```bash
git status --short codescout-companion/hooks/session-start.sh
```

If output is non-empty (file modified or staged), continue to Step 2. If clean, skip to Task 1.

- [ ] **Step 2: Revert prior partial fix**

Run:
```bash
git checkout HEAD -- codescout-companion/hooks/session-start.sh
git status --short codescout-companion/hooks/session-start.sh
```

Expected: no output (file matches HEAD).

---

## Task 1: Shared library `skill-hints.sh`

**Files:**
- Create: `codescout-companion/hooks/skill-hints.sh`
- Test: `tests/test-skill-hints-lib.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/test-skill-hints-lib.sh`:

```bash
#!/bin/bash
# tests/test-skill-hints-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── skill-hints lib ──"
LIB="$HOOK_DIR/skill-hints.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Test 1: first call emits hint and writes marker
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  mkdir -p "$CWD"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "test hint message")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "test hint message" ] && [ -f "$CWD/.buddy/sid-1/hint-emitted-recon" ]; then
    pass "first call: emits + marker written"
  else
    fail "first call: emits + marker written" "ctx=$CTX marker=$(ls -1 $CWD/.buddy/sid-1/ 2>/dev/null)"
  fi
)

# Test 2: second call with same marker → silent {}
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  source "$LIB"
  emit_skill_hint "recon" "first" >/dev/null
  OUT=$(emit_skill_hint "recon" "second")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "second call same topic: silent"
  else
    fail "second call same topic: silent" "got ctx=$CTX"
  fi
)

# Test 3: different topic still emits
(
  export CWD="$T/proj" SESSION_ID="sid-1"
  source "$LIB"
  emit_skill_hint "recon" "first" >/dev/null
  OUT=$(emit_skill_hint "verify" "verify hint")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "verify hint" ]; then
    pass "different topic: emits"
  else
    fail "different topic: emits" "ctx=$CTX"
  fi
)

# Test 4: new SESSION_ID re-emits same topic
(
  export CWD="$T/proj" SESSION_ID="sid-2"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "fresh session")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ "$CTX" = "fresh session" ] && [ -f "$CWD/.buddy/sid-2/hint-emitted-recon" ]; then
    pass "new SESSION_ID: re-emits"
  else
    fail "new SESSION_ID: re-emits" "ctx=$CTX"
  fi
)

# Test 5: empty SESSION_ID → silent
(
  export CWD="$T/proj" SESSION_ID=""
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "msg")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "empty SESSION_ID: silent"
  else
    fail "empty SESSION_ID: silent" "ctx=$CTX"
  fi
)

# Test 6: empty CWD → silent
(
  export CWD="" SESSION_ID="sid-1"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "msg")
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  if [ -z "$CTX" ]; then
    pass "empty CWD: silent"
  else
    fail "empty CWD: silent" "ctx=$CTX"
  fi
)

# Test 7: read-only marker dir → emits but no crash
(
  export CWD="$T/ro" SESSION_ID="sid-1"
  mkdir -p "$CWD/.buddy"
  chmod 555 "$CWD/.buddy"
  source "$LIB"
  OUT=$(emit_skill_hint "recon" "ro test" 2>/dev/null)
  CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
  chmod 755 "$CWD/.buddy"  # cleanup permission
  if [ "$CTX" = "ro test" ]; then
    pass "read-only marker dir: emits"
  else
    fail "read-only marker dir: emits" "ctx=$CTX"
  fi
)

print_summary "skill-hints lib"
```

Make it executable:
```bash
chmod +x tests/test-skill-hints-lib.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
bash tests/test-skill-hints-lib.sh
```

Expected: FAIL — `$HOOK_DIR/skill-hints.sh` does not exist; the `source` lines abort early with "No such file or directory".

- [ ] **Step 3: Create the shared library**

Create `codescout-companion/hooks/skill-hints.sh`:

```bash
#!/bin/bash
# codescout-companion/hooks/skill-hints.sh
# Shared library: skill-hint emission + session-scoped marker dedup.
# Source from any companion hook that needs to fire a one-shot, session-scoped
# skill pointer.
#
# Caller must set CWD and SESSION_ID before invoking emit_skill_hint.
# Marker convention: $CWD/.buddy/$SESSION_ID/hint-emitted-<topic>

# emit_skill_hint <topic> <hint_text>
# Stdout: {"hookSpecificOutput":{"additionalContext": <hint>}} on first call
#         for <topic> in this session. Touches the marker.
#         Silent {} when marker present, SESSION_ID empty, or CWD empty.
emit_skill_hint() {
  local topic="$1"
  local hint="$2"
  if [ -z "$SESSION_ID" ] || [ -z "$CWD" ]; then
    jq -n '{}'
    return
  fi
  local marker_dir="$CWD/.buddy/$SESSION_ID"
  local marker="$marker_dir/hint-emitted-$topic"
  if [ -f "$marker" ]; then
    jq -n '{}'
    return
  fi
  mkdir -p "$marker_dir" 2>/dev/null
  touch "$marker" 2>/dev/null
  jq -n --arg ctx "$hint" '{hookSpecificOutput:{additionalContext:$ctx}}'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bash tests/test-skill-hints-lib.sh
```

Expected: all 7 tests PASS; summary line `── skill-hints lib: 7 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/skill-hints.sh tests/test-skill-hints-lib.sh
git commit -m "feat(companion): skill-hints.sh shared library + tests

Session-scoped dedup helper for one-shot skill pointer emission.
emit_skill_hint(topic, hint) writes additionalContext on first call
per (SESSION_ID, topic), touches a marker file under .buddy/\$SID/,
returns silent {} on subsequent calls. Tests cover first/repeat call,
distinct topics, new SESSION_ID, empty inputs, read-only marker dir.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 2: PreToolUse hint hook on `Task` (Agent dispatch)

**Files:**
- Create: `codescout-companion/hooks/pre-task-hint.sh`
- Test: `tests/test-pre-task-hint.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/test-pre-task-hint.sh`:

```bash
#!/bin/bash
# tests/test-pre-task-hint.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-task-hint ──"
HOOK="$HOOK_DIR/pre-task-hint.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"
make_codescout_dir "$T/proj"  # marks codescout as detected

hook_input() {
  printf '{"cwd":"%s","session_id":"%s","tool_name":"Task","tool_input":{}}' "$T/proj" "$1"
}

# Test 1: first Task call → emits hint
OUT=$(hook_input "sid-1" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "first call: hint emitted"
else
  fail "first call: hint emitted" "$OUT"
fi

if [ -f "$T/proj/.buddy/sid-1/hint-emitted-recon" ]; then
  pass "first call: marker written"
else
  fail "first call: marker written" "missing $T/proj/.buddy/sid-1/hint-emitted-recon"
fi

# Test 2: second Task call same SID → silent
OUT=$(hook_input "sid-1" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "second call same SID: silent"
else
  fail "second call same SID: silent" "ctx=$CTX"
fi

# Test 3: new SESSION_ID → re-emits
OUT=$(hook_input "sid-2" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "new SID: re-emits"
else
  fail "new SID: re-emits" "$OUT"
fi

# Test 4: codescout absent → exits 0 silently
rm -rf "$T/proj/.codescout"
rm -f "$T/proj/.mcp.json"
OUT=$(hook_input "sid-3" | bash "$HOOK" 2>/dev/null)
EC=$?
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ "$EC" -eq 0 ] && [ -z "$CTX" ]; then
  pass "no codescout: silent exit 0"
else
  fail "no codescout: silent exit 0" "ec=$EC ctx=$CTX"
fi

# Test 5: empty session_id → no marker, but exits 0
make_codescout_dir "$T/proj"
write_mcp_json "$T/proj"
OUT=$(printf '{"cwd":"%s","session_id":"","tool_name":"Task","tool_input":{}}' "$T/proj" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ "$EC" -eq 0 ] && ! [ -f "$T/proj/.buddy//hint-emitted-recon" ]; then
  pass "empty session_id: exit 0 no marker"
else
  fail "empty session_id: exit 0 no marker" "ec=$EC"
fi

# Test 6: payload size — hint <500 bytes well under 2 KB cap
OUT=$(hook_input "sid-size" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
SIZE=${#CTX}
if [ "$SIZE" -gt 0 ] && [ "$SIZE" -lt 500 ]; then
  pass "hint size <500 bytes (got $SIZE)"
else
  fail "hint size <500 bytes" "size=$SIZE"
fi

print_summary "pre-task-hint"
```

Make executable:
```bash
chmod +x tests/test-pre-task-hint.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
bash tests/test-pre-task-hint.sh
```

Expected: FAIL — `$HOOK_DIR/pre-task-hint.sh` does not exist.

- [ ] **Step 3: Create the hook**

Create `codescout-companion/hooks/pre-task-hint.sh`:

```bash
#!/bin/bash
# codescout-companion/hooks/pre-task-hint.sh
# PreToolUse hook on Task — emit recon pointer on first Agent dispatch
# this session. Dedup via .buddy/$SID/hint-emitted-recon marker.

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

source "$(dirname "$0")/detect-tools.sh"
[ "$HAS_CODESCOUT" = "false" ] && exit 0

source "$(dirname "$0")/skill-hints.sh"

emit_skill_hint "recon" "First Agent dispatch this session. Reconnaissance recommended before subagent work — call Skill('codescout-companion:reconnaissance') for the full method unless this seam has already been scouted."
exit 0
```

Make executable:
```bash
chmod +x codescout-companion/hooks/pre-task-hint.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bash tests/test-pre-task-hint.sh
```

Expected: all 6 tests PASS; summary line `── pre-task-hint: 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/pre-task-hint.sh tests/test-pre-task-hint.sh
git commit -m "feat(companion): PreToolUse pre-task-hint.sh — recon pointer on first Agent dispatch

Hook fires once per session on Task (Agent dispatch); injects a one-line
additionalContext pointer recommending Skill('codescout-companion:reconnaissance')
unless the seam has already been scouted. Marker .buddy/\$SID/hint-emitted-recon
provides session-scoped dedup via skill-hints.sh shared library. Exits 0
silently when codescout is not detected.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 3: PreToolUse hint hook on `mcp__codescout__edit_code|replace_symbol`

**Files:**
- Create: `codescout-companion/hooks/pre-edit-hint.sh`
- Test: `tests/test-pre-edit-hint.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/test-pre-edit-hint.sh`:

```bash
#!/bin/bash
# tests/test-pre-edit-hint.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-edit-hint ──"
HOOK="$HOOK_DIR/pre-edit-hint.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"
make_codescout_dir "$T/proj"

hook_input() {
  local sid="$1"
  local tool="$2"
  printf '{"cwd":"%s","session_id":"%s","tool_name":"%s","tool_input":{}}' "$T/proj" "$sid" "$tool"
}

# Test 1: first edit_code call → emits hint
OUT=$(hook_input "sid-1" "mcp__codescout__edit_code" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "first edit_code: hint emitted"
else
  fail "first edit_code: hint emitted" "$OUT"
fi

if [ -f "$T/proj/.buddy/sid-1/hint-emitted-recon-edit" ]; then
  pass "first edit_code: marker written (recon-edit)"
else
  fail "first edit_code: marker written" "missing marker"
fi

# Test 2: second edit_code same SID → silent
OUT=$(hook_input "sid-1" "mcp__codescout__edit_code" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "second edit_code same SID: silent"
else
  fail "second edit_code same SID: silent" "ctx=$CTX"
fi

# Test 3: replace_symbol counts under same marker (both are shape-changing)
OUT=$(hook_input "sid-1" "mcp__codescout__replace_symbol" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ -z "$CTX" ]; then
  pass "replace_symbol after edit_code: silent (shared marker)"
else
  fail "replace_symbol after edit_code: silent" "ctx=$CTX"
fi

# Test 4: fresh session, first replace_symbol → emits
OUT=$(hook_input "sid-2" "mcp__codescout__replace_symbol" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "reconnaissance"; then
  pass "fresh SID first replace_symbol: emits"
else
  fail "fresh SID first replace_symbol: emits" "$OUT"
fi

# Test 5: hint mentions shape-change context (edit_code|replace_symbol)
OUT=$(hook_input "sid-3" "mcp__codescout__edit_code" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "shape" || assert_context_contains "$OUT" "struct" || assert_context_contains "$OUT" "signature"; then
  pass "hint mentions shape-change semantics"
else
  fail "hint mentions shape-change semantics" "$OUT"
fi

# Test 6: codescout absent → exit 0 silently
rm -rf "$T/proj/.codescout" "$T/proj/.mcp.json"
OUT=$(hook_input "sid-4" "mcp__codescout__edit_code" | bash "$HOOK" 2>/dev/null)
EC=$?
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
if [ "$EC" -eq 0 ] && [ -z "$CTX" ]; then
  pass "no codescout: silent exit 0"
else
  fail "no codescout: silent exit 0" "ec=$EC ctx=$CTX"
fi

print_summary "pre-edit-hint"
```

Make executable:
```bash
chmod +x tests/test-pre-edit-hint.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
bash tests/test-pre-edit-hint.sh
```

Expected: FAIL — `$HOOK_DIR/pre-edit-hint.sh` does not exist.

- [ ] **Step 3: Create the hook**

Create `codescout-companion/hooks/pre-edit-hint.sh`:

```bash
#!/bin/bash
# codescout-companion/hooks/pre-edit-hint.sh
# PreToolUse hook on mcp__codescout__(edit_code|replace_symbol) — emit
# recon-for-shape-changes pointer on first shape-changing edit this session.
# Dedup via .buddy/$SID/hint-emitted-recon-edit marker (shared across
# edit_code and replace_symbol because both are shape-changing seams).

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

source "$(dirname "$0")/detect-tools.sh"
[ "$HAS_CODESCOUT" = "false" ] && exit 0

source "$(dirname "$0")/skill-hints.sh"

emit_skill_hint "recon-edit" "First shape-changing edit this session (edit_code|replace_symbol). If the change touches struct fields, function signatures, or API contracts not yet scouted, call Skill('codescout-companion:reconnaissance') first."
exit 0
```

Make executable:
```bash
chmod +x codescout-companion/hooks/pre-edit-hint.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bash tests/test-pre-edit-hint.sh
```

Expected: all 6 tests PASS; summary line `── pre-edit-hint: 6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/pre-edit-hint.sh tests/test-pre-edit-hint.sh
git commit -m "feat(companion): PreToolUse pre-edit-hint.sh — recon pointer on first shape-changing edit

Hook fires once per session on mcp__codescout__(edit_code|replace_symbol);
injects a one-line additionalContext pointer recommending recon for changes
that touch struct fields, function signatures, or API contracts. Marker
.buddy/\$SID/hint-emitted-recon-edit is shared across edit_code and
replace_symbol because both invoke the same seam-shape-change semantics.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 4: Register both hooks in `hooks.json`

**Files:**
- Modify: `codescout-companion/hooks/hooks.json`
- Test: `tests/test-hooks-json-registration.sh`

- [ ] **Step 1: Write the failing test**

Create `tests/test-hooks-json-registration.sh`:

```bash
#!/bin/bash
# tests/test-hooks-json-registration.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── hooks.json registration ──"
HOOKS_JSON="$HOOK_DIR/hooks.json"

# Test 1: hooks.json parses as valid JSON
if jq empty "$HOOKS_JSON" 2>/dev/null; then
  pass "hooks.json is valid JSON"
else
  fail "hooks.json is valid JSON"
fi

# Test 2: Task matcher registered to pre-task-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Task") | .hooks[0].command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-task-hint.sh"; then
  pass "Task matcher → pre-task-hint.sh"
else
  fail "Task matcher → pre-task-hint.sh" "got: $MATCH"
fi

# Test 3: edit_code|replace_symbol matcher registered to pre-edit-hint.sh
MATCH=$(jq -r '.hooks.PreToolUse[] | select(.matcher | test("edit_code|replace_symbol")) | .hooks[0].command' "$HOOKS_JSON")
if echo "$MATCH" | grep -q "pre-edit-hint.sh"; then
  pass "edit_code|replace_symbol matcher → pre-edit-hint.sh"
else
  fail "edit_code|replace_symbol matcher → pre-edit-hint.sh" "got: $MATCH"
fi

# Test 4: existing matchers preserved (pre-tool-guard, il3-deny, worktree-write-guard)
for keep in "pre-tool-guard.sh" "il3-deny-hook.sh" "worktree-write-guard.sh"; do
  if grep -q "$keep" "$HOOKS_JSON"; then
    pass "preserved: $keep"
  else
    fail "preserved: $keep"
  fi
done

print_summary "hooks.json registration"
```

Make executable:
```bash
chmod +x tests/test-hooks-json-registration.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
bash tests/test-hooks-json-registration.sh
```

Expected: tests 2 and 3 FAIL (Task and edit_code matchers not yet present). Tests 1, 4, 5, 6 PASS.

- [ ] **Step 3: Add the two PreToolUse entries**

Open `codescout-companion/hooks/hooks.json`. Inside the `PreToolUse` array, append two new entries after the existing `mcp__.*__run_command` entry (which is currently the last in that array). The full PreToolUse array should look like:

```json
"PreToolUse": [
  {
    "matcher": "mcp__.*__(edit_lines|replace_symbol|insert_code|create_file|create_or_update_file)",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/worktree-write-guard.sh"
      }
    ]
  },
  {
    "matcher": "Grep|Glob|Read|Bash|Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-guard.sh"
      }
    ]
  },
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/git-worktree-guard.sh"
      }
    ]
  },
  {
    "matcher": "mcp__.*__run_command",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/il3-deny-hook.sh"
      }
    ]
  },
  {
    "matcher": "Task",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-task-hint.sh"
      }
    ]
  },
  {
    "matcher": "mcp__codescout__(edit_code|replace_symbol)",
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-edit-hint.sh"
      }
    ]
  }
]
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bash tests/test-hooks-json-registration.sh
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/hooks.json tests/test-hooks-json-registration.sh
git commit -m "feat(companion): register pre-task-hint + pre-edit-hint in hooks.json

Two new PreToolUse entries:
- matcher 'Task' → pre-task-hint.sh (Agent dispatch hint)
- matcher 'mcp__codescout__(edit_code|replace_symbol)' → pre-edit-hint.sh
  (shape-change edit hint)

Existing matchers (pre-tool-guard, il3-deny, worktree-write-guard,
git-worktree-guard) preserved unchanged.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 5: Strip content injection from `session-start.sh`, emit pointers

**Files:**
- Modify: `codescout-companion/hooks/session-start.sh`

This task removes the verbatim recon body (`${RECON_BODY}`) and verbatim system prompt (`${CS_SYSTEM_PROMPT}`) injection blocks. Replaces them with a single `SKILLS AVAILABLE` pointer block. Existing memory hint, GitHub identity, drift warnings, worktree reminder, post-compact flush all remain unchanged.

- [ ] **Step 1: Locate the current state**

Read the current file:
```bash
cat codescout-companion/hooks/session-start.sh | grep -n "System prompt injection\|Reconnaissance skill primer\|recon-loaded\|SKILLS AVAILABLE"
```

Expected output includes lines for `# --- System prompt injection ---` and `# --- Reconnaissance skill primer ---`. The exact line numbers will depend on whether the pre-flight revert restored HEAD.

- [ ] **Step 2: Delete the "System prompt injection" block**

Locate this block in `codescout-companion/hooks/session-start.sh`:

```bash
# --- System prompt injection ---
if [ "$HAS_CS_SYSTEM_PROMPT" = "true" ]; then
  MSG="${MSG}${CS_SYSTEM_PROMPT}

"
fi
```

Delete it entirely (all 6 lines).

- [ ] **Step 3: Delete the "Reconnaissance skill primer" block**

Locate this block:

```bash
# --- Reconnaissance skill primer ---
# Inject the full SKILL.md verbatim on every session start (including
# resume/compact) so its instructions are inline in context — no Skill-tool
# call required to load. Marker file feeds the buddy [recon] statusline badge.
PLUGIN_ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RECON_SKILL="$PLUGIN_ROOT_DIR/skills/reconnaissance/SKILL.md"
if [ -f "$RECON_SKILL" ]; then
  RECON_BODY=$(cat "$RECON_SKILL")
  MSG="${MSG}<!-- codescout-companion:reconnaissance loaded at SessionStart -->
RECONNAISSANCE SKILL — pre-loaded for this session (no Skill-tool call needed):

${RECON_BODY}

"
  # Session-scoped marker: tells buddy statusline that recon is in scope.
  # Distinct from .recon-active (LLM touches during a scout) — this one
  # is always present once the primer fires, no freshness check.
  if [ -n "$SESSION_ID" ] && [ -n "$CWD" ]; then
    BUDDY_SESSION_DIR="$CWD/.buddy/$SESSION_ID"
    mkdir -p "$BUDDY_SESSION_DIR" 2>/dev/null
    touch "$BUDDY_SESSION_DIR/recon-loaded" 2>/dev/null
  fi
fi
```

Delete the entire block (~22 lines).

- [ ] **Step 4: Insert the new `SKILLS AVAILABLE` block plus statusline marker**

Find the existing `# --- Memory hint ---` block (which ends with `fi`). Immediately AFTER the `fi` that closes it, INSERT:

```bash
# --- Skill pointers (replaces verbatim content injection — see
# docs/superpowers/specs/2026-05-19-injection-budget-design.md) ---
MSG="${MSG}SKILLS AVAILABLE:
- Reconnaissance — Skill('codescout-companion:reconnaissance'). Recommended before subagent dispatch or shape-changing edits.
- System prompt for this project — read_memory('system-prompt').

"

# Statusline marker (kept from prior recon-primer block — feeds buddy [recon] badge).
if [ -n "$SESSION_ID" ] && [ -n "$CWD" ]; then
  mkdir -p "$CWD/.buddy/$SESSION_ID" 2>/dev/null
  touch "$CWD/.buddy/$SESSION_ID/recon-loaded" 2>/dev/null
fi

```

The marker touch is preserved because the buddy statusline reads `.buddy/$SID/recon-loaded` to decide whether to show the `[recon]` badge — that signal is independent of whether the skill body is injected.

- [ ] **Step 5: Hand-verify the change**

Run:
```bash
grep -n "SKILLS AVAILABLE\|Memory hint\|System prompt\|Reconnaissance skill primer\|recon-loaded\|GitHub identity" codescout-companion/hooks/session-start.sh
```

Expected: presence of `Memory hint`, `Skill pointers`, `recon-loaded`, `GitHub identity`, `Statusline marker`. **Absence** of `System prompt injection` and `Reconnaissance skill primer`.

- [ ] **Step 6: Sanity-run the hook with a representative input**

Run:
```bash
T=$(mktemp -d)
mkdir -p "$T/proj/.codescout"
echo '[project]' > "$T/proj/.codescout/project.toml"
cat > "$T/proj/.mcp.json" <<EOF
{"mcpServers":{"codescout":{"command":"/bin/true","args":[]}}}
EOF
echo '{"cwd":"'$T'/proj","session_id":"test-sid","source":"startup"}' | bash codescout-companion/hooks/session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | wc -c
rm -rf "$T"
```

Expected: a byte count well under 2048 (target ~1500). Exact value varies with optional fields (GitHub identity, drift warnings) — the assertion in Task 6 nails it down formally.

- [ ] **Step 7: Commit**

```bash
git add codescout-companion/hooks/session-start.sh
git commit -m "refactor(companion): session-start emits skill pointers, not content

Drop verbatim injection of \${CS_SYSTEM_PROMPT} (~2 KB) and the
recon SKILL.md body (~12 KB) — both landed past CC's ~2 KB
additionalContext cap and were dead content.

Replace with a SKILLS AVAILABLE block of one-line pointers:
- Skill('codescout-companion:reconnaissance')
- read_memory('system-prompt')

Full SKILL.md loads via the Skill tool when the model invokes it
(empirical channel capacity ≥12 KB; see W-2 in injection-budget-
session-log.md). The recon-loaded marker file is preserved so the
buddy statusline can still show the [recon] badge.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 6: Session-start payload regression test

**Files:**
- Create: `tests/test-session-start-payload.sh`

- [ ] **Step 1: Write the test**

Create `tests/test-session-start-payload.sh`:

```bash
#!/bin/bash
# tests/test-session-start-payload.sh — payload-size and pointer-content
# regression guard for the injection-budget redesign.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── session-start payload ──"
HOOK="$HOOK_DIR/session-start.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"
make_codescout_dir "$T/proj"
make_memories "$T/proj"          # creates .code-explorer/memories
make_system_prompt "$T/proj"     # creates .code-explorer/system-prompt.md

INPUT=$(printf '{"cwd":"%s","session_id":"size-sid","source":"startup"}' "$T/proj")
OUT=$(echo "$INPUT" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
SIZE=${#CTX}

# Test 1: total payload ≤ 2048 bytes
if [ "$SIZE" -le 2048 ]; then
  pass "payload size $SIZE B ≤ 2048"
else
  fail "payload size $SIZE B exceeds 2 KB preview cap"
fi

# Test 2: recon pointer present in first 2 KB
PREVIEW=$(printf '%s' "$CTX" | head -c 2048)
if echo "$PREVIEW" | grep -q "codescout-companion:reconnaissance"; then
  pass "recon pointer in first 2 KB"
else
  fail "recon pointer in first 2 KB"
fi

# Test 3: system-prompt pointer present
if echo "$PREVIEW" | grep -q "read_memory('system-prompt')"; then
  pass "system-prompt pointer present"
else
  fail "system-prompt pointer present"
fi

# Test 4: no verbatim recon SKILL.md body
if echo "$CTX" | grep -q "## When to Use"; then
  fail "verbatim recon body still present (expected pointer only)"
else
  pass "no verbatim recon body"
fi

# Test 5: no verbatim system prompt body
if echo "$CTX" | grep -q "SYSTEM PROMPT CONTENT"; then
  fail "verbatim system prompt still present"
else
  pass "no verbatim system prompt body"
fi

# Test 6: memory hint preserved
if echo "$PREVIEW" | grep -q "codescout MEMORIES"; then
  pass "memory hint preserved"
else
  fail "memory hint preserved"
fi

# Test 7: recon-loaded marker still written
if [ -f "$T/proj/.buddy/size-sid/recon-loaded" ]; then
  pass "recon-loaded marker written (statusline badge)"
else
  fail "recon-loaded marker written" "missing $T/proj/.buddy/size-sid/recon-loaded"
fi

print_summary "session-start payload"
```

Make executable:
```bash
chmod +x tests/test-session-start-payload.sh
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
bash tests/test-session-start-payload.sh
```

Expected: all 7 tests PASS. The payload is built without GitHub identity (no `gh` configured in fixture) and without drift warnings (no drift_report seeded), so size will be ~600-800 B in this fixture — well under 2048 B.

- [ ] **Step 3: Run the broader payload check with GitHub + drift present**

Run:
```bash
T=$(mktemp -d)
source tests/lib/fixtures.sh
make_git_repo "$T/proj"
write_mcp_json "$T/proj"
make_codescout_dir "$T/proj"
make_memories "$T/proj"
make_system_prompt "$T/proj"
seed_drift_db "$T/proj" "abc1234"
echo '{"cwd":"'$T'/proj","session_id":"max-sid","source":"startup"}' | bash codescout-companion/hooks/session-start.sh 2>/dev/null \
  | jq -r '.hookSpecificOutput.additionalContext' | wc -c
rm -rf "$T"
```

Expected: byte count still ≤ 2048 (target ≤ ~1500 with drift block added). If the value exceeds 2048, the design's headroom assumption is wrong and Task 6 must add a hard size assertion plus revise the spec. (Spec lists this as a Risk; if it fires, file an F-N in `injection-budget-session-log.md` before proceeding.)

- [ ] **Step 4: Commit**

```bash
git add tests/test-session-start-payload.sh
git commit -m "test(companion): session-start payload regression guard

Asserts:
- Total additionalContext ≤ 2048 bytes (CC preview cap)
- Recon pointer present in first 2 KB
- read_memory('system-prompt') pointer present
- No verbatim recon SKILL.md body
- No verbatim system-prompt body
- Memory hint preserved
- recon-loaded marker still written (buddy statusline)

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

---

## Task 7: Update existing `tests/test-session-start.sh` if it asserts old content

**Files:**
- Possibly modify: `tests/test-session-start.sh`

- [ ] **Step 1: Run the existing session-start test**

Run:
```bash
bash tests/test-session-start.sh
```

Expected outcomes:
- **Case A (pass)**: existing test does not assert on the dropped content; no changes needed. Skip to Step 4.
- **Case B (fail)**: existing test asserts on a string that no longer appears in the payload (e.g. `RECONNAISSANCE SKILL` header, `# --- Reconnaissance skill primer ---` text, or a verbatim system-prompt line). Continue to Step 2.

- [ ] **Step 2: Identify the failing assertions**

The test will report failures via `fail "..."` lines. Read each failure message; it will name the string the test expected to find. For each failure, decide:

- If the string was a check on the (now-removed) verbatim content → delete the assertion; the new `test-session-start-payload.sh` covers the replacement contract.
- If the string was a check on truly removed behavior (e.g. recon-loaded marker) → the marker is preserved (see Task 5 Step 4); ensure the assertion still works against the new code path.
- If the string was a check on unchanged behavior (memory hint, GitHub identity, drift warnings) → the assertion should still pass; if it fails, that's a regression in this PR.

- [ ] **Step 3: Apply targeted edits**

Update only the failing assertions. Do not rewrite the test file wholesale. Use `edit_file` with exact `old_string` / `new_string` pairs.

- [ ] **Step 4: Re-run**

Run:
```bash
bash tests/test-session-start.sh
```

Expected: PASS.

- [ ] **Step 5: Commit (only if Step 2-3 actually modified the file)**

```bash
git add tests/test-session-start.sh
git commit -m "test(companion): drop assertions on removed verbatim content

The session-start hook no longer injects \${CS_SYSTEM_PROMPT} or the
verbatim recon SKILL.md body (see task 5 of injection-budget plan).
Remove assertions that checked for those strings; replacement contract
is covered by tests/test-session-start-payload.sh.

Refs: docs/superpowers/specs/2026-05-19-injection-budget-design.md"
```

If the file was not modified, skip the commit and move to Task 8.

---

## Task 8: Full suite verification

- [ ] **Step 1: Run all tests**

Run:
```bash
./tests/run-all.sh
```

Expected: every suite reports `0 failed`. Final summary line: `✓ All suites passed.`

- [ ] **Step 2: If any suite fails**

Investigate the failure. Do NOT bump the plugin version until all tests pass. If a pre-existing test (unrelated to this PR) fails, capture as F-N in `docs/trackers/injection-budget-session-log.md` and decide whether to fix in-scope or defer.

- [ ] **Step 3: Sanity-check git log**

Run:
```bash
git log --oneline -10
```

Expected: 5-6 new commits from this plan (one per task that produced changes), each with a clear `feat(companion):`, `refactor(companion):`, or `test(companion):` prefix.

---

## Task 9: Version bump

Per `CLAUDE.md` "When bumping a plugin version" checklist. This formalizes the release of the injection-budget redesign.

- [ ] **Step 1: Verify pre-bump preconditions**

- All tests pass (`./tests/run-all.sh` exits 0): confirmed in Task 8.
- No more changes planned for this version: this is the terminal task.
- `git status` clean: run `git status`; if any uncommitted changes remain in this work-stream, commit them before proceeding.

- [ ] **Step 2: Decide new version number**

Read current version:
```bash
jq -r '.version' codescout-companion/.claude-plugin/plugin.json
```

This is a minor change (new hooks, refactor of one existing hook, no breaking API). Bump the minor segment. For example: `1.10.0 → 1.11.0`.

- [ ] **Step 3: Update plugin.json**

Edit `codescout-companion/.claude-plugin/plugin.json`. Change the `version` field to the chosen value (e.g. `"1.11.0"`).

- [ ] **Step 4: Update README.md version table**

Open `README.md` at the repo root. Find the version table for `codescout-companion` and update its row to the new version.

- [ ] **Step 5: Verify consistency**

Run:
```bash
./scripts/check-versions.sh
```

Expected: exit 0, no errors.

- [ ] **Step 6: Seed the versioned cache directory in all profiles**

Run:
```bash
./scripts/bump-cache.sh codescout-companion <new-version>
```

Substitute `<new-version>` (e.g. `1.11.0`).

Expected: script reports rsync to all three profiles (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`).

- [ ] **Step 7: Update install records in all three profiles**

For each profile root (`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`):

```bash
PROFILE=~/.claude   # repeat for ~/.claude-sdd and ~/.claude-kat
NEW_VERSION=1.11.0  # substitute
jq --arg v "$NEW_VERSION" --arg p "$PROFILE/plugins/cache/sdd-misc-plugins/codescout-companion/$NEW_VERSION" \
   '(.plugins["codescout-companion@sdd-misc-plugins"][0].version) = $v
   | (.plugins["codescout-companion@sdd-misc-plugins"][0].installPath) = $p' \
   "$PROFILE/plugins/installed_plugins.json" > /tmp/ip.json && \
   mv /tmp/ip.json "$PROFILE/plugins/installed_plugins.json"
```

Run for all three profiles.

- [ ] **Step 8: Verify install records on disk**

Run:
```bash
for p in ~/.claude ~/.claude-sdd ~/.claude-kat; do
  for plug in codescout-companion buddy; do
    v=$(jq -r ".plugins[\"$plug@sdd-misc-plugins\"][0].version" "$p/plugins/installed_plugins.json")
    [ -d "$p/plugins/cache/sdd-misc-plugins/$plug/$v" ] && echo "✓ $p $plug $v" || echo "✗ $p $plug $v MISSING"
  done
done
```

Expected: all rows show `✓`.

- [ ] **Step 9: Refresh the version-bump-checklist tracker**

Per `CLAUDE.md`, run:

```
artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)
artifact(action="get", id="cc8cb9e23ab5cc67", full=true)
```

Verify every row is ✅. Any ❌ blocks the bump and must be fixed before continuing.

- [ ] **Step 10: Commit the version bump**

```bash
git add codescout-companion/.claude-plugin/plugin.json README.md
git commit -m "chore: bump codescout-companion to <new-version>

Ships injection-budget redesign:
- session-start emits skill pointers, not content
- pre-task-hint.sh + pre-edit-hint.sh PreToolUse hooks
- session-start payload regression test

See docs/superpowers/specs/2026-05-19-injection-budget-design.md
and docs/trackers/injection-budget-session-log.md (F-1..F-3, W-1, W-2)."
```

Substitute the actual new version in the subject line.

- [ ] **Step 11: Push and restart all CC instances**

```bash
git push
```

Then restart each running Claude Code instance (the user does this manually; the plan does not automate restarts).

---

## Done

After Task 9 lands and CC is restarted, validate in a fresh session:

1. Start a new CC session in `/home/marius/work/claude/claude-plugins`.
2. Inspect the SessionStart `<persisted-output>` block in the model's initial reminder. Expected: `SKILLS AVAILABLE` block visible in the first 2 KB preview.
3. Dispatch a Task via the Agent tool. Expected: a `_hint` line about reconnaissance appears in the next assistant turn's context.
4. Dispatch a second Task immediately. Expected: no hint (dedup'd).
5. Spot-check the `.buddy/$SID/` directory: contains `recon-loaded` and `hint-emitted-recon`.

If any of those steps misbehaves, file an F-N in `docs/trackers/injection-budget-session-log.md` with the observed vs expected.

W-1 promotion criterion (per session log) — a second multi-finding pre-spec recon — should be on the watchlist for future design sessions.
