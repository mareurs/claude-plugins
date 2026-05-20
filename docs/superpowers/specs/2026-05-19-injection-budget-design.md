---
status: draft
kind: design
opened: 2026-05-19
owner: marius
tags: [codescout-companion, hooks, prompt-channels, injection-budget, recon]
related:
  - "[mcp-channel-caps ADR](../../../../code-explorer/docs/architecture/mcp-channel-caps.md) — evidence base"
  - "[mcp-prompt-channel-redesign](../../../../code-explorer/docs/superpowers/specs/2026-05-19-mcp-prompt-channel-redesign-design.md) — sibling design"
  - "[injection-budget-session-log](../../trackers/injection-budget-session-log.md) — F-N / W-N ledger"
---

# Injection Budget Redesign — Companion Session-Start + PreToolUse Hint Hooks

## Summary

The `codescout-companion` SessionStart hook today emits ~16 KB of `additionalContext`
into a channel that Claude Code truncates at ~2 KB. The reconnaissance skill (12 KB
`SKILL.md`, injected verbatim) lands entirely past the cut and never reaches the
model. The project's `.code-explorer/system-prompt.md` also exceeds the budget on
its own (~2 KB), pushing every later block — including the recon primer — into the
dead zone.

This design adopts the same structural answer that the sibling codescout MCP redesign
(`mcp-channel-caps` ADR + `mcp-prompt-channel-redesign` spec) committed to:
**inject pointers, not content; load content on demand via tool-call results.**
SessionStart shrinks to a small fixed-budget pointer payload (≤1.5 KB). New
PreToolUse hint hooks fire just-in-time hints (e.g. "first Agent dispatch this
session — call `Skill('codescout-companion:reconnaissance')`") with session-scoped
dedup. Full skill bodies load via the existing built-in `Skill` tool, whose
tool-call channel has progressive-disclosure budget (~100 KB) and is unaffected by
the 2 KB cap.

## Status

**Design phase.** Spec drafted from a brainstorming session that re-used the
findings of the codescout-side investigation (`mcp-channel-caps` ADR). Implementation
plan to follow once the user reviews this spec.

Reconnaissance pass before externalizing this spec produced four ledger entries in
[`docs/trackers/injection-budget-session-log.md`](../../trackers/injection-budget-session-log.md):
F-1 (test naming), F-2 (`hooks/lib/` convention), F-3 (`edit_code` matcher staleness),
W-1 (pre-spec recon caught all three).

## Goals

1. **Recon trigger conditions visible to the model on every session.** The "when
   to use" and "when not to use" decision points must reach the model — either
   inline (within the 2 KB SessionStart payload) or one tool-call away via a
   pointer the model is reliably aware of.
2. **Just-in-time skill reminders at seam moments.** When the model is about to
   dispatch an Agent (first Agent dispatch this session) or about to make a
   shape-changing edit (first `edit_code`/`replace_symbol` call this session),
   surface a one-line hint pointing at the relevant skill.
3. **Scalable to future skills (mechanism only; not new hooks in this spec).** The
   marker + hook pattern must extend cleanly so that adding
   verification-before-completion, writing-plans, or other skill hints is a future
   PR — one new hook file + one matcher entry, no re-engineering. This spec ships
   the recon hooks only; other skills are explicitly out of scope.
4. **Stay within CC's hook output cap.** Every per-hook payload ≤2 KB.
5. **No behavior regressions.** Existing companion hooks (PreToolUse IL3 guard,
   worktree activation, drift warnings, GitHub identity injection) continue to
   work unchanged.

## Non-goals

- **Rewriting the recon `SKILL.md` for size.** The full skill stays at its current
  ~12 KB; loaded via the Skill tool on demand. This spec does not condense the
  skill body — that is a separate decision orthogonal to channel mechanics.
- **Fixing the stale `worktree-write-guard.sh` matcher** (captured as a side-bug
  in F-3). The hook's regex omits `edit_code`/`edit_file`/`edit_markdown`; a
  follow-up `docs/issues/` entry tracks the fix.
- **Eliminating SessionStart entirely** in favor of pure PreToolUse hints.
  SessionStart still carries memory hints, system-prompt pointer, GitHub identity,
  drift warnings, worktree-state reminders — all useful inside the 2 KB budget
  when content injection is replaced by pointers.
- **Adding a companion MCP server.** The companion stays hooks-only. The `Skill`
  tool we rely on for loading is built into Claude Code, not a companion-provided
  tool.

## Constraints

1. **CC's `additionalContext` cap is ~2 KB across all channels** (SessionStart,
   PreToolUse, MCP `initialize.instructions`, per-tool `description`). Evidence:
   `mcp-channel-caps` ADR with empirical probe results (`SENTINEL_2000_EE` visible,
   `SENTINEL_2500_FF` not visible).
2. **Tool-call results respect `MAX_MCP_OUTPUT_TOKENS` (~25 K tokens ≈ 100 KB)**
   and use codescout's `@tool_*` buffer for progressive disclosure when over.
   This is the only autonomous channel with >2 KB capacity, and the `Skill` tool
   uses it.
3. **Hook output format is fixed** by CC: `{"hookSpecificOutput":
   {"additionalContext":"..."}}`. JSON construction via `jq -n --arg ctx ...`
   handles escaping.
4. **Marker files live under `.buddy/$SESSION_ID/`** — convention established by
   existing `recon-loaded` and `recon-active` markers in `session-start.sh`.
5. **Tests follow `tests/test-*.sh` naming.** `tests/run-all.sh` globs that prefix
   pattern (see F-1).
6. **Hooks layout is flat.** `codescout-companion/hooks/*.sh` peers source each
   other via `source "$(dirname "$0")/<peer>.sh"` (see F-2).

## Architecture

Four surfaces, mirroring the codescout-side `mcp-prompt-channel-redesign` structure
but mapped to the companion's hooks-only world.

```
┌──────────────────────────────────────────────────────────────────┐
│ Surface A — SessionStart additionalContext (≤2 KB)               │
│   • Memory hint (~235 B, unchanged)                              │
│   • System-prompt pointer (1 line: "read_memory('system-prompt')")│
│   • Skill pointers — one line per loadable skill                 │
│     "Recon — Skill('codescout-companion:reconnaissance')         │
│      before subagent dispatch"                                   │
│   • GitHub identity (kept, ~250 B)                               │
│   • Drift warnings / onboarding / worktree (kept, conditional)   │
│   Total budget: ~1.5 KB worst case, fits cleanly                 │
└──────────────────────────────────────────────────────────────────┘
                                ↑
                  references ↓  │  (model invokes via Skill tool)
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│ Surface B — Skill tool (built into CC, no companion code)        │
│   • Skill('codescout-companion:reconnaissance') →                │
│     full SKILL.md as tool-call result (no 2 KB cap)              │
│   • read_memory('system-prompt') →                               │
│     full project nav prompt as tool result                       │
└──────────────────────────────────────────────────────────────────┘
                                ↑
                  hints  ↓
                                │
┌──────────────────────────────────────────────────────────────────┐
│ Surface C — PreToolUse hint injection (just-in-time)             │
│   • Hook on Task (Agent dispatch): if marker                     │
│     .buddy/$SID/hint-emitted-recon absent →                      │
│     additionalContext: "First Agent dispatch this session.       │
│     Recon recommended — call Skill('...:reconnaissance')         │
│     unless already scouted." Touch marker.                       │
│   • Hook on mcp__codescout__(edit_code|replace_symbol):          │
│     same dedup mechanism with marker hint-emitted-recon-edit.    │
│   • Reset: new SESSION_ID seeds new .buddy/$SID/ dir.            │
└──────────────────────────────────────────────────────────────────┘
                                │
┌──────────────────────────────────────────────────────────────────┐
│ Surface D — Skill registry (existing)                            │
│   • codescout-companion/skills/reconnaissance/SKILL.md           │
│   • Future: verification-before-completion, writing-plans...     │
│   • Each skill maps to:                                          │
│     - trigger event (Task / edit_code / Stop / PostToolUse)      │
│     - dedup topic (e.g. "recon", "verify", "plans")              │
└──────────────────────────────────────────────────────────────────┘
```

**Net shift from current state:**
- Drop verbatim `${CS_SYSTEM_PROMPT}` injection (~2 KB). Replace with 1-line pointer.
- Drop verbatim `${RECON_BODY}` injection (~12 KB, mostly dead). Replace with 1-line pointer.
- Session-start payload: ~16 KB → ~1.5 KB. Fits 2 KB preview window with room to spare.
- New PreToolUse hint hooks fire skill pointers at moment-of-need, not just session-start.

## Components

### Files affected

```
codescout-companion/
├── hooks/
│   ├── session-start.sh           [MODIFY] strip content injection, emit pointers only
│   ├── pre-task-hint.sh           [NEW] PreToolUse on Task → recon pointer (dedup'd)
│   ├── pre-edit-hint.sh           [NEW] PreToolUse on mcp__codescout__(edit_code|replace_symbol)
│   ├── skill-hints.sh             [NEW] shared library: emit_skill_hint() + marker mgmt
│   └── hooks.json                 [MODIFY] register two new PreToolUse entries

tests/
├── test-pre-task-hint.sh          [NEW]
├── test-pre-edit-hint.sh          [NEW]
├── test-skill-hints-lib.sh        [NEW]
└── test-session-start-payload.sh  [NEW] payload-size regression
```

### `hooks/skill-hints.sh` (new shared library, peer of `detect-tools.sh`)

```bash
#!/bin/bash
# Shared library: skill-hint emission + marker dedup.
# Source from any companion hook that needs to fire a one-shot, session-scoped
# skill pointer.
#
# Expects: SESSION_ID, CWD set by caller before invoking emit_skill_hint.
# Convention: marker lives at $CWD/.buddy/$SESSION_ID/hint-emitted-<topic>.

# emit_skill_hint <topic> <hint_text>
# Emits {"hookSpecificOutput":{"additionalContext": <hint>}} on stdout if the
# session-scoped marker for <topic> is absent. Then touches the marker.
# Returns silent {} when marker present, SESSION_ID empty, or CWD empty.
emit_skill_hint() {
  local topic="$1" hint="$2"
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
  mkdir -p "$marker_dir" 2>/dev/null && touch "$marker" 2>/dev/null
  jq -n --arg ctx "$hint" '{hookSpecificOutput:{additionalContext:$ctx}}'
}
```

### `hooks/pre-task-hint.sh` (new)

```bash
#!/bin/bash
# PreToolUse hook on Task — emit recon pointer on first Agent dispatch this session.
source "$(dirname "$0")/detect-tools.sh"
source "$(dirname "$0")/skill-hints.sh"
[ "$HAS_CODESCOUT" = "false" ] && exit 0

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

emit_skill_hint "recon" "First Agent dispatch this session. Reconnaissance recommended before subagent work — call Skill('codescout-companion:reconnaissance') for the full method unless this seam already scouted."
exit 0
```

### `hooks/pre-edit-hint.sh` (new)

Identical shape; different topic + message:

```bash
emit_skill_hint "recon-edit" "First shape-changing edit this session (edit_code|replace_symbol). If the change touches struct fields, function signatures, or API contracts not yet scouted, call Skill('codescout-companion:reconnaissance') first."
```

### `hooks/hooks.json` additions

Append to the existing `PreToolUse` array:

```json
{
  "matcher": "Task",
  "hooks": [{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/pre-task-hint.sh"}]
},
{
  "matcher": "mcp__codescout__(edit_code|replace_symbol)",
  "hooks": [{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/pre-edit-hint.sh"}]
}
```

### `hooks/session-start.sh` modifications

In the `MSG` construction:

1. **Remove** the verbatim `${CS_SYSTEM_PROMPT}` injection block.
2. **Remove** the verbatim `${RECON_BODY}` injection block (the `# --- Reconnaissance
   skill primer ---` section currently at lines ~73-95).
3. **Add** a `SKILLS AVAILABLE` block:

```bash
MSG="${MSG}SKILLS AVAILABLE:
- Reconnaissance — Skill('codescout-companion:reconnaissance'). Recommended before subagent dispatch or shape-changing edits.
- System prompt for this project — read_memory('system-prompt').

"
```

4. **Keep** the `.buddy/$SESSION_ID/recon-loaded` marker touch (still useful for
   the buddy `[recon]` statusline badge — signals that the skill is in-scope
   even though the body isn't injected verbatim).

## Data flow

### Path 1: Fresh session, model dispatches first Task

1. CC starts session → SessionStart hook fires. `session-start.sh` emits memory hint, SKILLS AVAILABLE pointers, GitHub identity, drift warnings, connectivity. Total payload ~1.5 KB → fits 2 KB preview, model sees all pointers.
2. Model reads pointers, knows recon skill exists, holds in context.
3. Model decides to dispatch Agent for task X. Calls `Task(...)` → PreToolUse fires.
4. `pre-task-hint.sh`: marker `hint-emitted-recon` absent → emit hint, touch marker. Hint reaches model: *"First Agent dispatch. Recon recommended."*
5. Model branches:
   - **(a)** Has not scouted → calls `Skill('codescout-companion:reconnaissance')` → CC loads full SKILL.md as tool-call result (~12 KB, no cap). Model executes scout, then dispatches Agent.
   - **(b)** Already scouted this seam → proceeds with Task directly.
   Hint is advisory; Task call proceeds either way.
6. Subsequent `Task()` calls: marker present → hook returns `{}` → no injection.

### Path 2: Model calls `mcp__codescout__edit_code` on a struct

1. PreToolUse fires on `mcp__codescout__edit_code`.
2. `pre-edit-hint.sh` checks marker `hint-emitted-recon-edit`.
3. First call → emits edit-focused hint, touches marker.
4. Subsequent shape-changing edits → silent (dedup'd).

### Path 3: Workspace switch / new project

1. `cs-activate-project.sh` (existing) detects activation.
2. New session activation seeds new `SESSION_ID` → new `.buddy/$SESSION_ID/` dir → markers absent by default.
3. First `Task`/`edit_code` in new session re-emits hints.

### Path 4: Session resume (compact / restore)

1. SessionStart with `source=resume` or `source=compact`. `session-start.sh` emits pointers again (idempotent).
2. Marker files persist on disk under the resumed `SESSION_ID` → PreToolUse hints stay dedup'd across resume. (If CC reuses SESSION_ID across resume, markers correctly persist; if CC seeds a new SESSION_ID on resume, hints fire fresh — both behaviors are safe.)

### State diagram for marker lifecycle

```
absent ──(hook fires)──> present
   ↑                        │
   └──(new SESSION_ID)──────┘
```

Markers are session-scoped. No global state, no cross-session leak.

## Error handling

| Failure | Behavior | Reason |
|---|---|---|
| `jq` missing | session-start prints warning, exits 0; PreToolUse hooks exit 0 silently | Already current behavior; `jq` is hard dependency |
| `SESSION_ID` empty in PreToolUse input | `emit_skill_hint` returns `{}`, no hint, no marker | Without ID can't dedup; better silent than spam |
| `CWD` empty | `emit_skill_hint` returns `{}` | Same |
| `.buddy/$SID/` unwritable (read-only fs) | `mkdir -p` + `touch` silently fail (`2>/dev/null`); hint emits but no dedup → fires every call | Acceptable degradation; hint is advisory |
| Marker file present but unreadable | `[ -f ]` returns true, hint suppressed | Conservative: assume previously hinted |
| Hint text contains chars that break JSON | `jq -n --arg ctx ...` handles escaping | jq guarantees valid JSON |
| `detect-tools.sh` reports `HAS_CODESCOUT=false` | PreToolUse exits 0 immediately | Companion is no-op when codescout absent |
| Hook timeout (CC kills hook >5s) | No partial state; marker either written or not | `touch` is atomic at fs level |
| Concurrent Task dispatches (race) | Both hooks may pass marker check, both emit hint | Acceptable: two hints worst case, model ignores duplicate |

### Marker sweep

In `session-start.sh`, sweep `.buddy/<sid>/` dirs older than 7 days:

```bash
find "$CWD/.buddy/" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null || true
```

Mirrors existing `$CS_ACTIVE_DIR` sweep. Cheap, rare, ignore errors.

### Hook output contract

Every new hook returns either:
- `{}` (no-op, silent — when dedup'd or guarded)
- `{"hookSpecificOutput":{"additionalContext":"..."}}` (hint)

Never exits non-zero. Never uses `permissionDecision: deny`. Hints are advisory,
not blocking — matches recon SKILL.md's own non-blocking design.

### Failure-mode invariant

> If anything in the hint mechanism breaks, the model loses a recommendation.
> It never loses access to the skill (Skill tool is built into CC), never gets
> blocked from dispatching, never sees a malformed prompt. The companion's
> existing PreToolUse guard (`pre-tool-guard.sh`) continues to enforce IL3
> rules independently.

## Tests

### `tests/test-session-start-payload.sh` — payload-size regression

```bash
# Build session-start input fixture (onboarded project, memories present)
OUT=$(echo "$INPUT" | bash codescout-companion/hooks/session-start.sh)
ctx=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext')
size=${#ctx}
[ "$size" -le 2048 ] || fail "payload $size B exceeds 2 KB preview cap"
# Recon pointer must be present in first 2 KB
echo "$ctx" | head -c 2048 | grep -q "codescout-companion:reconnaissance" || fail "recon pointer missing"
# No verbatim recon body
echo "$ctx" | grep -q "## When to Use" && fail "verbatim recon body present (expected pointer only)"
# No verbatim system prompt
echo "$ctx" | grep -q "# claude-plugins — Code Explorer Guidance" && fail "verbatim system prompt present"
```

### `tests/test-pre-task-hint.sh` — dedup + first-fire

```bash
setup_fixture_repo
# First call: hint emitted, marker written
OUT1=$(echo '{"cwd":"'$CWD'","session_id":"sid-1","tool_name":"Task"}' \
        | bash codescout-companion/hooks/pre-task-hint.sh)
ctx1=$(echo "$OUT1" | jq -r '.hookSpecificOutput.additionalContext // empty')
[ -n "$ctx1" ] || fail "first Task call should emit hint"
echo "$ctx1" | grep -q "reconnaissance" || fail "hint text missing skill ref"
[ -f "$CWD/.buddy/sid-1/hint-emitted-recon" ] || fail "marker not written"

# Second call: dedup'd
OUT2=$(echo '{"cwd":"'$CWD'","session_id":"sid-1","tool_name":"Task"}' \
        | bash codescout-companion/hooks/pre-task-hint.sh)
ctx2=$(echo "$OUT2" | jq -r '.hookSpecificOutput.additionalContext // empty')
[ -z "$ctx2" ] || fail "second Task call should NOT emit hint"

# New session_id: re-emits
OUT3=$(echo '{"cwd":"'$CWD'","session_id":"sid-2","tool_name":"Task"}' \
        | bash codescout-companion/hooks/pre-task-hint.sh)
ctx3=$(echo "$OUT3" | jq -r '.hookSpecificOutput.additionalContext // empty')
[ -n "$ctx3" ] || fail "new session should re-emit hint"
```

### `tests/test-pre-edit-hint.sh`

Same shape; different marker key (`hint-emitted-recon-edit`); different hint
message.

### `tests/test-skill-hints-lib.sh` — unit tests for `emit_skill_hint`

- `emit_skill_hint recon "msg"` with no marker → emits + touches marker.
- Same call again → returns `{}` (silent).
- Marker dir read-only → emits but doesn't touch marker (degraded, no crash).
- `SESSION_ID` empty → returns `{}` immediately.
- `CWD` empty → returns `{}` immediately.

### Existing tests touched

- `tests/run-all.sh` — already globs `test-*.sh` (F-1 confirmed); picks up new
  tests automatically.

### Verification before ship

```bash
./tests/run-all.sh                         # all green
# Manual probe (CC running):
# Start a fresh session in claude-plugins/, dispatch a Task via Agent tool.
# Observe hint appears in CC transcript on first Task; absent on second.
# Verify SessionStart payload preview includes recon pointer (not body).
```

## Migration

1. Land the spec + tracker (this commit).
2. Implementation in a separate PR following the plan derived from this spec.
3. Bump `codescout-companion` plugin version per `CLAUDE.md` version-bump
   checklist (cache seed, install-record update across `~/.claude`,
   `~/.claude-sdd`, `~/.claude-kat`).
4. Manually verify in each profile that:
   - SessionStart payload preview shows recon pointer.
   - First Task dispatch triggers hint.
   - Second Task dispatch is silent.
5. After 1 week of dogfooding, decide whether to:
   - Add similar hint hooks for other skills (verification-before-completion on
     Stop, writing-plans on first edit, etc.).
   - File the worktree-write-guard staleness side-bug (F-3 Fix idea).
   - Promote W-1 to a permanent rule in `writing-plans` skill or `CLAUDE.md`
     after a second multi-finding pre-spec recon validates the pattern.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The 2 KB cap on PreToolUse `additionalContext` is tighter than on SessionStart | low | Our hints are <300 B per emit. Verify empirically in the first PR via the `test-pre-task-hint.sh` payload-size assertion (≤2 KB). |
| Model ignores the hint and dispatches Agent without scouting anyway | medium | Hint is advisory by design; this is recon's own posture. If empirical sessions show the hint is ignored frequently, escalate to a pre-tool *gate* (deny + correction text), but only after data. |
| Removing verbatim `${CS_SYSTEM_PROMPT}` injection regresses some workflow that relied on it being inline | medium | The system prompt remains accessible via `read_memory('system-prompt')`. The pointer line tells the model where it lives. Dogfood for 1 week before considering a rollback. |
| `Task` matcher syntax wrong in `hooks.json` | low | Mirrored from CC docs; verified empirically once first PR lands by checking that the hook actually fires on Agent dispatch. |
| Marker dir `.buddy/$SID/` collides with existing `recon-active`/`recon-loaded` markers | none | New marker name `hint-emitted-<topic>` is namespace-distinct; no collision. |

## Open questions resolved (in brainstorming session)

- **Skill content vs additionalContext cap.** Skill tool result channel respects
  `MAX_MCP_OUTPUT_TOKENS` (~100 KB) and uses progressive disclosure. Not affected
  by the 2 KB cap. Confirmed by user — Skill tool calls in this session have
  loaded full SKILL.md content (>12 KB) successfully.
- **Read/edit routing.** Native `Read`/`Edit`/`Write` on source files are denied
  by existing `pre-tool-guard.sh`. The active edit channel is
  `mcp__codescout__edit_code` (and `replace_symbol`, `edit_file`, `edit_markdown`).
  PreToolUse on the codescout MCP tools is therefore the correct trigger surface.
- **Scope.** Treat as a general injection-budget design, not recon-specific. The
  mechanism scales to additional skills via per-topic markers + per-event hooks.
- **F-N capture vs spec-inline.** F-1/F-2/F-3 captured in
  `docs/trackers/injection-budget-session-log.md` with monotonic IDs (per recon
  SKILL.md Phase 3 — IDs make lessons portable across sessions).

## References

- `/home/marius/work/claude/code-explorer/docs/architecture/mcp-channel-caps.md` —
  ADR establishing the 2 KB cap evidence base (empirical sentinel probes).
- `/home/marius/work/claude/code-explorer/docs/superpowers/specs/2026-05-19-mcp-prompt-channel-redesign-design.md` —
  Sibling design on the codescout MCP side; same structural pattern applied to
  MCP `initialize.instructions` + per-tool `description`.
- `/home/marius/work/claude/code-explorer/docs/trackers/get-guide-topics.md` —
  Surface D tracker (sibling pattern).
- `/home/marius/work/claude/code-explorer/src/tools/guide.rs` — `get_guide`
  tool implementation that this design's `Skill` invocation mirrors.
- `codescout-companion/hooks/session-start.sh` — current SessionStart hook
  (modification target).
- `codescout-companion/hooks/hooks.json` — current hook registration
  (modification target).
- `codescout-companion/skills/reconnaissance/SKILL.md` — full skill body
  (loaded via Skill tool, not injected).
- `docs/trackers/injection-budget-session-log.md` — F-N / W-N ledger for this
  work stream.
