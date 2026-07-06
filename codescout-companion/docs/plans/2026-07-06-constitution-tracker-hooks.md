# Constitution Tracker — Companion-Plugin Enforcement Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Claude Code hooks that make codescout's `constitution` tracker archetype (see `docs/superpowers/plans/2026-07-06-constitution-tracker-archetype-and-cli.md` in the `codescout` repo, which this plan depends on and must land first) mechanically enforced rather than prose-trusted: a `PreToolUse` deny for path-scoped rules, a `UserPromptSubmit` injection for global rules, and a `PreCompact` epoch bump so both survive context compaction.

**Architecture:** All three hooks are self-contained Bash scripts (matching this plugin's existing style — see `hooks/il3-deny-hook.sh`), each shelling into the `codescout constitution-check` CLI subcommand the dependency plan produces. State is a single per-session JSON file, `$CWD/.codescout/constitution-seen/<session_id>.json`, shaped `{"epoch": N, "seen_path_rules": [...], "global_surfaced_epoch": N}`. `PreCompact` bumping `epoch` is what makes a rule "unseen again" after compaction — both other hooks compare against the *current* epoch, never a cached one.

**Tech Stack:** Bash, `jq` (already a hard dependency of every hook in this plugin — see `session-start.sh`'s jq-presence check), the plugin's existing `hooks.json` registration schema.

## Global Constraints

- Every hook must degrade to silent allow (empty stdout, `exit 0`) on any internal failure — missing `jq`, missing `codescout` binary, malformed JSON from the CLI, missing `session_id`/`cwd` in the hook input. A broken constitution check must never block an unrelated tool call. This mirrors `il3-deny-hook.sh`'s and `pre-tool-guard.sh`'s existing behavior.
- Deny JSON shape (verified working in this plugin today, `hooks/il3-deny-hook.sh`):
  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
  ```
- `additionalContext` injection shape (verified working, `hooks/session-start.sh`):
  ```json
  {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
  ```
  `UserPromptSubmit`'s equivalent (`hookEventName: "UserPromptSubmit"`) is **not yet used anywhere in this plugin** — Task 2's manual verification step exists specifically to confirm Claude Code actually honors it the same way before relying on it further.
- `hooks.json`'s registration schema (verified, current file): `{"hooks": {"<EventName>": [{"matcher": "<regex>", "hooks": [{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/<file>.sh"}]}]}}`. Neither `PreCompact` nor `UserPromptSubmit` keys exist in the file today — Task 2 and Task 3 add them fresh.
- No `PreCompact` or `UserPromptSubmit` hook exists anywhere in this plugin to copy from — the only prior art is an **unimplemented, stale-schema** draft (`docs/plans/2026-04-02-session-intelligence-design.md`); do not copy its `hooks.json` snippet, it uses a flat shape that doesn't match the real schema above.

---

### Task 1: `constitution-guard.sh` — PreToolUse deny for path-scoped rules

**Files:**
- Create: `hooks/constitution-guard.sh`
- Create: `hooks/constitution-guard.test.sh`
- Modify: `hooks/hooks.json` — add a `PreToolUse` matcher block

**Interfaces:**
- Consumes: `codescout constitution-check --path <path> --project <dir>` (from the dependency plan) — stdout is a JSON array of `{id, tracker_id, title, rule}` objects, or `[]`.
- Produces: the state file `$CWD/.codescout/constitution-seen/<session_id>.json`, consumed by Task 3 (`PreCompact`, which bumps `epoch` and clears `seen_path_rules`) and read (but not written) by Task 2 (`UserPromptSubmit`, which reads `epoch`).

- [ ] **Step 1: Write the failing test**

Create `hooks/constitution-guard.test.sh`:

```bash
#!/bin/bash
# Tests for constitution-guard.sh. Stubs the `codescout` binary via PATH so
# this test needs no real build and no real catalog — see
# hooks/il3-deny-hook.test.sh for the black-box invocation style this mirrors.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-guard.sh"
PASS=0
FAIL=0

STUB_DIR=$(mktemp -d)
cat > "$STUB_DIR/codescout" <<'EOF'
#!/bin/bash
echo "${CS_STUB_RESPONSE:-[]}"
EOF
chmod +x "$STUB_DIR/codescout"
export PATH="$STUB_DIR:$PATH"

PROJECT=$(mktemp -d)

assert() {
  local label="$1" input="$2" expected_decision="$3"
  local got decision
  got=$(echo "$input" | "$HOOK")
  decision=$(echo "$got" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
  if [ "$decision" = "$expected_decision" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected $expected_decision, got $decision (raw: $got)"
  fi
}

mkinput() {
  local sid="$1" path="$2"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" --arg p "$path" \
    '{tool_name:"Edit", cwd:$cwd, session_id:$sid, tool_input:{file_path:$p}}'
}

export CS_STUB_RESPONSE='[]'
assert "no matches -> allow" "$(mkinput s1 src/x.kt)" "allow"

export CS_STUB_RESPONSE='[{"id":"C-1","tracker_id":"t1","title":"T","rule":"R"}]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert "unseen match -> deny" "$(mkinput s2 src/solver/x.kt)" "deny"
assert "same session, same rule, second touch -> allow" "$(mkinput s2 src/solver/y.kt)" "allow"
assert "different session -> deny again (not seen in THIS session)" "$(mkinput s3 src/solver/x.kt)" "deny"

echo "== constitution-guard.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `chmod +x hooks/constitution-guard.test.sh && hooks/constitution-guard.test.sh`
Expected: FAIL — `hooks/constitution-guard.sh: No such file or directory` (script doesn't exist yet).

- [ ] **Step 3: Write the hook**

Create `hooks/constitution-guard.sh`:

```bash
#!/bin/bash
# PreToolUse hook — enforces path-scoped constitution rules via a one-time-
# per-epoch deny. A "constitution" tracker (codescout kind=tracker, tagged
# "constitution") holds rules the agent must follow no matter what. The
# first time a tool touches a matching path this epoch, the call is denied
# with the rule's text as the reason — the channel proven to actually reach
# the model (a denied call's reason comes back as content the model reads).
# Subsequent touches in the same epoch are allowed silently.
# constitution-epoch-bump.sh (PreCompact) resets exposure after a
# compaction, since the model's effective context may no longer contain a
# rule it "already saw" pre-compaction.
#
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo) for the full design.

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TARGET_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // .tool_input.file_path // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$TARGET_PATH" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

CS_BIN=$(command -v codescout 2>/dev/null) || exit 0
[ -z "$CS_BIN" ] && exit 0

MATCHES=$("$CS_BIN" constitution-check --path "$TARGET_PATH" --project "$CWD" 2>/dev/null)
echo "$MATCHES" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1 || exit 0

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR" 2>/dev/null
[ -f "$STATE_FILE" ] || echo '{"epoch":0,"seen_path_rules":[],"global_surfaced_epoch":-1}' > "$STATE_FILE"
STATE=$(cat "$STATE_FILE")

UNSEEN=$(jq -n --argjson matches "$MATCHES" --argjson state "$STATE" \
  '$matches | map(select(.id as $id | ($state.seen_path_rules | index($id)) == null))')

[ "$(echo "$UNSEEN" | jq 'length')" -eq 0 ] && exit 0

REASON=$(echo "$UNSEEN" | jq -r 'map("[\(.id)] \(.title)\n\(.rule)") | join("\n\n")')

NEW_STATE=$(jq -n --argjson state "$STATE" --argjson unseen "$UNSEEN" \
  '$state * {seen_path_rules: ($state.seen_path_rules + ($unseen | map(.id)))}')
echo "$NEW_STATE" > "$STATE_FILE"

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
```

Make it executable: `chmod +x hooks/constitution-guard.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `hooks/constitution-guard.test.sh`
Expected: `== constitution-guard.sh: 4 passed, 0 failed ==`, exit 0

- [ ] **Step 5: Register the hook in `hooks.json`**

In `hooks/hooks.json`, add a new matcher block to the existing `"PreToolUse"` array (e.g. right after the `mcp__codescout__(edit_code|edit_file|edit_markdown|create_file)` block):

```json
      {
        "matcher": "Edit|Write|mcp__codescout__(edit_code|edit_file|create_file)",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/constitution-guard.sh"
          }
        ]
      },
```

(`edit_markdown` is intentionally excluded — constitution rules target source/config paths, not documentation edits.)

- [ ] **Step 6: Commit**

```bash
git add hooks/constitution-guard.sh hooks/constitution-guard.test.sh hooks/hooks.json
git commit -m "feat(hooks): enforce path-scoped constitution rules via PreToolUse deny"
```

---

### Task 2: `constitution-brief.sh` — UserPromptSubmit injection for global rules

**Files:**
- Create: `hooks/constitution-brief.sh`
- Create: `hooks/constitution-brief.test.sh`
- Modify: `hooks/hooks.json` — add a new top-level `"UserPromptSubmit"` key (doesn't exist yet)

**Interfaces:**
- Consumes: `codescout constitution-check --project <dir>` (no `--path` — global mode, from the dependency plan), the same state file Task 1 writes (reads `epoch`, writes only `global_surfaced_epoch`).

- [ ] **Step 1: Write the failing test**

Create `hooks/constitution-brief.test.sh`:

```bash
#!/bin/bash
# Tests for constitution-brief.sh. Stubs `codescout` the same way
# constitution-guard.test.sh does.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-brief.sh"
PASS=0
FAIL=0

STUB_DIR=$(mktemp -d)
cat > "$STUB_DIR/codescout" <<'EOF'
#!/bin/bash
echo "${CS_STUB_RESPONSE:-[]}"
EOF
chmod +x "$STUB_DIR/codescout"
export PATH="$STUB_DIR:$PATH"

PROJECT=$(mktemp -d)

assert_has_context() {
  local label="$1" input="$2" expect_present="$3"
  local got ctx
  got=$(echo "$input" | "$HOOK")
  ctx=$(echo "$got" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
  local present="false"
  [ -n "$ctx" ] && present="true"
  if [ "$present" = "$expect_present" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected additionalContext present=$expect_present, got present=$present (raw: $got)"
  fi
}

mkinput() {
  local sid="$1"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" '{cwd:$cwd, session_id:$sid, prompt:"hi"}'
}

export CS_STUB_RESPONSE='[]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert_has_context "no global rules -> no context" "$(mkinput s1)" "false"

export CS_STUB_RESPONSE='[{"id":"C-2","tracker_id":"t1","title":"Never commit secrets","rule":"R"}]'
rm -rf "$PROJECT/.codescout/constitution-seen"
assert_has_context "global rule, first prompt this epoch -> context" "$(mkinput s2)" "true"
assert_has_context "global rule, second prompt same epoch -> no context" "$(mkinput s2)" "false"

echo "== constitution-brief.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `chmod +x hooks/constitution-brief.test.sh && hooks/constitution-brief.test.sh`
Expected: FAIL — `hooks/constitution-brief.sh: No such file or directory`.

- [ ] **Step 3: Write the hook**

Create `hooks/constitution-brief.sh`:

```bash
#!/bin/bash
# UserPromptSubmit hook — surfaces global (path-less) constitution rules
# once per epoch via additionalContext. Path-scoped rules are a different
# channel (constitution-guard.sh, PreToolUse) — this hook only ever calls
# `codescout constitution-check` WITHOUT --path.
#
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo) for the full design.

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

CS_BIN=$(command -v codescout 2>/dev/null) || exit 0
[ -z "$CS_BIN" ] && exit 0

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR" 2>/dev/null
[ -f "$STATE_FILE" ] || echo '{"epoch":0,"seen_path_rules":[],"global_surfaced_epoch":-1}' > "$STATE_FILE"
STATE=$(cat "$STATE_FILE")

EPOCH=$(echo "$STATE" | jq '.epoch')
SURFACED_EPOCH=$(echo "$STATE" | jq '.global_surfaced_epoch')
[ "$EPOCH" = "$SURFACED_EPOCH" ] && exit 0

RULES=$("$CS_BIN" constitution-check --project "$CWD" 2>/dev/null)
echo "$RULES" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1 || exit 0

DIGEST=$(echo "$RULES" | jq -r 'map("[\(.id)] \(.title)\n\(.rule)") | join("\n\n")')

NEW_STATE=$(echo "$STATE" | jq --argjson e "$EPOCH" '. * {global_surfaced_epoch: $e}')
echo "$NEW_STATE" > "$STATE_FILE"

jq -n --arg body "$DIGEST" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: ("Constitution rules — must follow no matter what:\n\n" + $body)
  }
}'
exit 0
```

Make it executable: `chmod +x hooks/constitution-brief.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `hooks/constitution-brief.test.sh`
Expected: `== constitution-brief.sh: 3 passed, 0 failed ==`, exit 0

- [ ] **Step 5: Register the hook in `hooks.json`**

`hooks.json` has no `"UserPromptSubmit"` key today. Add one as a new top-level sibling of `"PreToolUse"`/`"PostToolUse"`/`"Stop"`:

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/constitution-brief.sh"
          }
        ]
      }
    ],
```

(No `matcher` — `UserPromptSubmit` fires on every user turn regardless of tool, matching the `"SessionStart"`/`"Stop"` no-matcher blocks already in this file.)

- [ ] **Step 6: Manual verification of `additionalContext` for `UserPromptSubmit`**

This plugin has never used `UserPromptSubmit` before — `Task 2`'s test only proves the hook *emits* the right JSON shape, not that Claude Code actually injects it into context the way `SessionStart`'s `additionalContext` is confirmed to. After registering, start a real Claude Code session in a project with an active `constitution`-tagged tracker containing a global rule, send one prompt, and confirm the rule text appears in context (e.g. ask "what constitution rules are active right now" and see if the model can answer from the injected text, not by calling a tool). If it does not appear, the shape assumption in this task's Step 3 needs revisiting before trusting this channel.

- [ ] **Step 7: Commit**

```bash
git add hooks/constitution-brief.sh hooks/constitution-brief.test.sh hooks/hooks.json
git commit -m "feat(hooks): surface global constitution rules via UserPromptSubmit"
```

---

### Task 3: `constitution-epoch-bump.sh` — PreCompact epoch reset

**Files:**
- Create: `hooks/constitution-epoch-bump.sh`
- Create: `hooks/constitution-epoch-bump.test.sh`
- Modify: `hooks/hooks.json` — add a new top-level `"PreCompact"` key (doesn't exist yet)

**Interfaces:**
- Consumes/mutates: the same state file Tasks 1–2 use. Reads and rewrites `epoch` and `seen_path_rules`; leaves `global_surfaced_epoch` untouched (it naturally falls behind the bumped `epoch`, which is what makes Task 2 re-fire on the next prompt — no separate reset needed).

- [ ] **Step 1: Write the failing test**

Create `hooks/constitution-epoch-bump.test.sh`:

```bash
#!/bin/bash
# Tests for constitution-epoch-bump.sh — pure state-file mutation, no
# codescout binary involved.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/constitution-epoch-bump.sh"
PASS=0
FAIL=0

PROJECT=$(mktemp -d)
STATE_DIR="$PROJECT/.codescout/constitution-seen"
mkdir -p "$STATE_DIR"

assert_eq() {
  local label="$1" got="$2" expected="$3"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: $label — expected '$expected', got '$got'"
  fi
}

mkinput() {
  local sid="$1"
  jq -n --arg cwd "$PROJECT" --arg sid "$sid" '{cwd:$cwd, session_id:$sid}'
}

# No state file yet -> no-op, no crash.
echo "$(mkinput s1)" | "$HOOK"
assert_eq "no state file -> none created" "$([ -f "$STATE_DIR/s1.json" ] && echo yes || echo no)" "no"

# Existing state -> epoch increments, seen_path_rules clears, global_surfaced_epoch untouched.
echo '{"epoch":2,"seen_path_rules":["C-1","C-2"],"global_surfaced_epoch":2}' > "$STATE_DIR/s2.json"
echo "$(mkinput s2)" | "$HOOK"
NEW=$(cat "$STATE_DIR/s2.json")
assert_eq "epoch incremented" "$(echo "$NEW" | jq '.epoch')" "3"
assert_eq "seen_path_rules cleared" "$(echo "$NEW" | jq -c '.seen_path_rules')" "[]"
assert_eq "global_surfaced_epoch untouched" "$(echo "$NEW" | jq '.global_surfaced_epoch')" "2"

echo "== constitution-epoch-bump.sh: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `chmod +x hooks/constitution-epoch-bump.test.sh && hooks/constitution-epoch-bump.test.sh`
Expected: FAIL — `hooks/constitution-epoch-bump.sh: No such file or directory`.

- [ ] **Step 3: Write the hook**

Create `hooks/constitution-epoch-bump.sh`:

```bash
#!/bin/bash
# PreCompact hook — bumps the per-session constitution epoch so path-scoped
# (constitution-guard.sh) and global (constitution-brief.sh) rules are
# re-surfaced after compaction, since the model's effective context may no
# longer reliably contain a rule it "already saw" pre-compaction.
#
# NOTE: this plan does not depend on PreCompact supporting additionalContext
# or on its output surviving into the post-compaction context — verify
# during implementation whether it does, but the design only needs PreCompact
# to fire reliably before compaction, which is a much weaker assumption.
# See docs/superpowers/specs/2026-07-06-constitution-tracker-design.md
# (codescout repo), "Open items to verify during implementation".

command -v jq &>/dev/null || exit 0

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

[ -z "$SESSION_ID" ] && exit 0
[ -z "$CWD" ] && CWD="$(pwd)"

STATE_DIR="$CWD/.codescout/constitution-seen"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"

# No state file means no constitution rule has fired this session yet —
# nothing to bump.
[ -f "$STATE_FILE" ] || exit 0

STATE=$(cat "$STATE_FILE")
NEW_STATE=$(echo "$STATE" | jq '{epoch: (.epoch + 1), seen_path_rules: [], global_surfaced_epoch: .global_surfaced_epoch}')
echo "$NEW_STATE" > "$STATE_FILE"
exit 0
```

Make it executable: `chmod +x hooks/constitution-epoch-bump.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `hooks/constitution-epoch-bump.test.sh`
Expected: `== constitution-epoch-bump.sh: 4 passed, 0 failed ==`, exit 0

- [ ] **Step 5: Register the hook in `hooks.json`**

Add a new top-level `"PreCompact"` key:

```json
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/constitution-epoch-bump.sh"
          }
        ]
      }
    ],
```

- [ ] **Step 6: Commit**

```bash
git add hooks/constitution-epoch-bump.sh hooks/constitution-epoch-bump.test.sh hooks/hooks.json
git commit -m "feat(hooks): reset constitution rule exposure on PreCompact"
```

---

## Self-Review Notes

- **Spec coverage:** path-scoped deny-once-per-epoch (Task 1), global once-per-epoch injection (Task 2), and the epoch-bump-on-compaction mechanism (Task 3) each map to one task. The spec's "batching — multiple rules matching one call are combined into a single deny/injection" requirement is satisfied by both `constitution-guard.sh` and `constitution-brief.sh` building one combined `REASON`/`DIGEST` string via `jq -r 'map(...) | join(...)'` rather than looping and emitting per-rule.
- **Placeholder scan:** no TBDs. The two genuinely unverified items (`UserPromptSubmit`'s `additionalContext` behavior in Task 2, `PreCompact`'s exact capabilities in Task 3) are called out explicitly as manual-verification steps / non-dependencies, not silently assumed — consistent with the spec's own "Open items to verify during implementation" section.
- **Type/shape consistency:** all three hooks agree on the state file shape `{"epoch": int, "seen_path_rules": [string], "global_surfaced_epoch": int}` and its path `$CWD/.codescout/constitution-seen/<session_id>.json`. Task 1 initializes and appends to `seen_path_rules`; Task 2 initializes (if absent) and reads/writes only `global_surfaced_epoch`; Task 3 initializes are not needed (it no-ops on a missing file) and mutates `epoch` + clears `seen_path_rules`. No task assumes a field name the others don't also use.
- **Dependency:** none of these three hooks can be manually smoke-tested against a *real* constitution tracker until `docs/superpowers/plans/2026-07-06-constitution-tracker-archetype-and-cli.md` (codescout repo) has shipped and a `constitution`-tagged tracker exists somewhere to query. The test scripts in this plan stub the `codescout` binary specifically so implementation isn't blocked on that landing first — but Task 2's Step 6 manual verification does require it.
