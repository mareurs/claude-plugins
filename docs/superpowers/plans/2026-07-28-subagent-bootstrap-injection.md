# Subagent Bootstrap Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the `PROJECT BOOTSTRAP` triad (activate directive + inline memory topic names) to every codescout subagent via the `SubagentStart` hook.

**Architecture:** One behavior change to `codescout-companion/hooks/subagent-guidance.mjs` — prepend a soft-conditional activate paragraph resolved to the git toplevel, and fold `CS_MEMORY_NAMES` into the exploration protocol's Phase 0 bullet, replacing its `memory(action="list")` instruction. A new `CS_SUBAGENT_GUIDANCE_FORCE=1` env seam bypasses the config-based codescout gate so the hook is testable on any machine. The hook currently has no test file; this plan adds one covering both new and pre-existing behavior.

**Tech Stack:** Node ESM (`.mjs`, no dependencies), bash + `jq` test harness, `git` CLI for root resolution.

**Spec:** `docs/superpowers/specs/2026-07-28-subagent-bootstrap-injection-design.md`
**Recon findings this plan encodes:** F-1, F-2, F-3 in `docs/trackers/subagent-bootstrap-session-log.md`

## Global Constraints

- **Fail-open contract** (`hooks/lib.mjs` header): hooks MUST exit 0 even on error. A non-zero `PreToolUse` exit is itself a deny on Copilot CLI. Never let a crash block a user's tool.
- **Node-only.** No bash, no `jq`, no Python inside hook `.mjs` files — they must run on Windows and under GitHub Copilot without Git Bash.
- **`jq` is a required dependency** for test scripts (not for hooks).
- **Config dir resolution:** always `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, never bare `$HOME/.claude`.
- **Test isolation** (`CLAUDE.md`): every test that writes config/files/env must remove them before the next test runs. Pattern: write fixture → test → remove fixture.
- **`tests/run-all.sh` auto-discovers** `codescout-companion/hooks/*.test.sh` — no registration step.
- **Do not modify `detect.mjs`.** It is held at byte-parity with `scripts/detect.py` by `detect.test.sh`; changing one without the other breaks that suite.
- **`HAS_CODESCOUT` is config-based, not project-based.** No per-project fixture can close that gate. (F-2)

---

## File Structure

| File | Responsibility |
|---|---|
| `codescout-companion/hooks/subagent-guidance.mjs` | **Modify.** The only behavior change. Adds the force seam, root resolution, the bootstrap paragraph, and the Phase 0 memory bullet branch. |
| `codescout-companion/hooks/subagent-guidance.test.sh` | **Create.** Colocated suite. Layer 1 = gate tests, Layer 2 = output-shape tests driven through the force seam. |
| `codescout-companion/.claude-plugin/plugin.json` | **Modify (Task 4).** Version bump — canonical source of truth. |
| `README.md` | **Modify (Task 4).** Version table, updated by `release.sh`. |

No `hooks.json` change: `SubagentStart` → `subagent-guidance.mjs` is already registered.

---

### Task 1: Test harness + force seam + pre-existing-behavior guards

Establishes the suite and the seam every later task's tests depend on, and characterizes the two gates plus the system-prompt append that already work today. No output-shape change yet.

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs:5` (import), `:17-18` (gate)
- Create: `codescout-companion/hooks/subagent-guidance.test.sh`

**Interfaces:**
- Consumes: `readInput`, `detectFor`, `emit` from `./lib.mjs` (already imported); `d.HAS_CODESCOUT`, `d.HAS_CS_SYSTEM_PROMPT`, `d.CS_SYSTEM_PROMPT` from `detectFor`.
- Produces: the env seam name `CS_SUBAGENT_GUIDANCE_FORCE` (Tasks 2–3 test cases all run through it); the shell helpers `ok`, `has`, `hasnt`, `ctx` in the test file (Tasks 2–3 append cases using them).

- [ ] **Step 1: Write the failing test**

Create `codescout-companion/hooks/subagent-guidance.test.sh`:

```bash
#!/usr/bin/env bash
# Tests for subagent-guidance.mjs — the SubagentStart codescout briefing.
#
# Two layers:
#  1. Gate tests — agent_type exclusions, and the codescout gate driven to
#     CLOSED. The gate case overrides HOME + CLAUDE_CONFIG_DIR; a bare temp cwd
#     is NOT enough, because HAS_CODESCOUT is config-based, not per-project
#     (F-2 in docs/trackers/subagent-bootstrap-session-log.md). detect.mjs
#     consults ~/.claude.json only when CLAUDE_CONFIG_DIR is unset, so setting
#     it is what seals the last discovery path.
#  2. Output-shape tests — driven with CS_SUBAGENT_GUIDANCE_FORCE=1 so they run
#     on any machine regardless of local codescout config. Modelled on
#     explore-inject.test.sh, which is the suite that actually drives a hook
#     end-to-end; pre-task-hint.test.sh is config-only and is NOT a model for
#     output assertions (F-1).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/subagent-guidance.mjs"

PASS=0; FAIL=0
ok() {
  if [ "$2" = "$3" ]; then echo "PASS [$1]"; PASS=$((PASS+1));
  else echo "FAIL [$1]: exp=$3 got=$2"; FAIL=$((FAIL+1)); fi
}
has()   { case "$2" in *"$3"*) ok "$1" yes yes ;; *) ok "$1" no yes ;; esac; }
hasnt() { case "$2" in *"$3"*) ok "$1" present absent ;; *) ok "$1" absent absent ;; esac; }

# ctx <cwd> [agent_type] → injected additionalContext, forced past the gate.
ctx() {
  local cwd="$1" at="${2:-general-purpose}"
  jq -nc --arg cwd "$cwd" --arg at "$at" \
    '{cwd:$cwd,agent_type:$at,agent_id:"a1",session_id:"s1"}' \
    | CS_SUBAGENT_GUIDANCE_FORCE=1 node "$HOOK" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""'
}

# raw <cwd> <agent_type> → whole stdout, seam NOT set (for gate tests).
raw() {
  jq -nc --arg cwd "$1" --arg at "$2" '{cwd:$cwd,agent_type:$at}' | node "$HOOK" 2>/dev/null
}

# ---------- 1. Gates ----------

# Case 1: codescout not configured → silent. Needs env override, not just cwd.
T1=$(mktemp -d); mkdir -p "$T1/cfg"
O1=$(jq -nc --arg cwd "$T1" '{cwd:$cwd,agent_type:"general-purpose"}' \
      | HOME="$T1" CLAUDE_CONFIG_DIR="$T1/cfg" node "$HOOK" 2>/dev/null)
[ -z "$O1" ] && ok "gate: no codescout config → silent" silent silent \
             || ok "gate: no codescout config → silent" emitted silent
rm -rf "$T1"

# Case 2: excluded agent types exit before any detection.
for at in Bash statusline-setup claude-code-guide; do
  [ -z "$(raw /tmp "$at")" ] && ok "gate: agent_type $at → silent" silent silent \
                             || ok "gate: agent_type $at → silent" emitted silent
done

# Non-excluded type must NOT be silenced by the exclusion list.
T2=$(mktemp -d)
[ -n "$(ctx "$T2")" ] && ok "gate: general-purpose → emits" emits emits \
                      || ok "gate: general-purpose → emits" silent emits
rm -rf "$T2"

# ---------- 2. Pre-existing behavior (regression guards) ----------

# Case 7: system prompt still appended verbatim.
T7=$(mktemp -d); mkdir -p "$T7/.codescout"
printf 'SENTINEL-SYSPROMPT-SEVEN\n' > "$T7/.codescout/system-prompt.md"
O7=$(ctx "$T7")
has "sysprompt: appended verbatim" "$O7" "SENTINEL-SYSPROMPT-SEVEN"
has "sysprompt: protocol still present" "$O7" "codescout EXPLORATION PROTOCOL"
has "sysprompt: rules still present"    "$O7" "CODESCOUT RULES"
rm -rf "$T7"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`

Expected: FAIL on `gate: general-purpose → emits` and all three `sysprompt:` cases — `ctx()` sets `CS_SUBAGENT_GUIDANCE_FORCE=1`, but the hook does not honor it yet, so a `mktemp` cwd with no codescout config exits silently and `additionalContext` is empty. The `gate: no codescout config` and `gate: agent_type` cases should already PASS.

- [ ] **Step 3: Write minimal implementation**

In `codescout-companion/hooks/subagent-guidance.mjs`, extend the import to pull in `git` (needed by Task 2; added now so the import is touched once):

```javascript
import { readInput, detectFor, git, emit } from './lib.mjs';
```

Then replace the bare gate:

```javascript
const cwd = input.cwd || '';
const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);
```

with the seamed gate:

```javascript
const cwd = input.cwd || '';
const d = detectFor(cwd);

// Test seam: HAS_CODESCOUT is config-based, not per-project, so no fixture can
// close it — the suite forces it open instead. Mirrors explore-inject.mjs's
// CS_EXPLORE_INJECT_FORCE. See subagent-guidance.test.sh.
if (process.env.CS_SUBAGENT_GUIDANCE_FORCE !== '1') {
  if (d.HAS_CODESCOUT === 'false') process.exit(0);
}
```

Also update the file's header comment to record the seam:

```javascript
// SubagentStart hook — inject codescout guidance into coding subagents.
// Port of subagent-guidance.sh. Delivers the project bootstrap + exploration
// protocol + Iron-Laws reminder + the project system-prompt verbatim (the ONLY
// channel that reaches subagents — they don't get codescout's
// server_instructions, claude-code#29655).
//
// Testing seam: CS_SUBAGENT_GUIDANCE_FORCE=1 bypasses the codescout gate.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`
Expected: PASS — all 8 assertions. Final line `Fail: 0.`

Then confirm nothing else regressed: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/subagent-guidance.mjs codescout-companion/hooks/subagent-guidance.test.sh
git commit -m "test(codescout-companion): add subagent-guidance suite + force seam

subagent-guidance.mjs had no test file. Adds one covering both gates and
the verbatim system-prompt append, plus a CS_SUBAGENT_GUIDANCE_FORCE seam
mirroring explore-inject's, because HAS_CODESCOUT is config-based and no
fixture can close it (F-2).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Bootstrap paragraph with git-toplevel root resolution

Adds the activate directive. Root resolution is a correctness requirement, not a detail: `worktree-write-guard.mjs` places `.cs-worktree-pending` at `git rev-parse --show-toplevel`, and `cs-activate-project.mjs` releases it with a literal `join(tool_input.path, '.cs-worktree-pending')` — so an `activate(path=cwd)` from a worktree *subdirectory* would never release the guard.

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` (root resolution + `msg` initialization)
- Modify: `codescout-companion/hooks/subagent-guidance.test.sh` (append Layer 3)

**Interfaces:**
- Consumes: `git(cwd, args)` from `./lib.mjs` — returns trimmed stdout, or `null` on error/non-zero exit. Imported in Task 1.
- Produces: the literal marker string `PROJECT BOOTSTRAP:` and the substring `path="<root>"` in `additionalContext`; the shell variable convention `O<n>` for captured output. Task 3 asserts against the same `additionalContext`.

- [ ] **Step 1: Write the failing test**

Insert into `subagent-guidance.test.sh`, immediately before the `echo "---"` summary block:

```bash
# ---------- 3. Bootstrap paragraph + root resolution ----------

# Case 8 + activate presence: plain (non-repo) cwd falls back to cwd.
T8=$(mktemp -d)
O8=$(ctx "$T8")
has "bootstrap: marker present"        "$O8" "PROJECT BOOTSTRAP:"
has "bootstrap: names cwd as fallback" "$O8" "path=\"$T8\""
has "bootstrap: soft-conditional wording" "$O8" \
    "unless the task below names a different project root"
has "bootstrap: names the pin escape"  "$O8" 'pin every call with workspace='
rm -rf "$T8"

# Case 5: cwd is a SUBDIRECTORY of a repo → activate must name the toplevel,
# not the subdir. A subdir path would not match .cs-worktree-pending's location
# and so would never release worktree-write-guard.
T5=$(mktemp -d)
git -C "$T5" init -q
git -C "$T5" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$T5/nested/deeper"
ROOT5=$(git -C "$T5" rev-parse --show-toplevel)
O5=$(ctx "$T5/nested/deeper")
has   "subdir: activate names repo toplevel" "$O5" "path=\"$ROOT5\""
hasnt "subdir: does not name the subdir"     "$O5" "path=\"$T5/nested/deeper\""
rm -rf "$T5"

# Case 6: worktree cwd → fires, and names the WORKTREE root (not the main repo).
T6=$(mktemp -d)
mkdir -p "$T6/main"
git -C "$T6/main" init -q
git -C "$T6/main" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$T6/main" worktree add -q "$T6/wt" -b wtbranch >/dev/null 2>&1
WT6=$(git -C "$T6/wt" rev-parse --show-toplevel)
MAIN6=$(git -C "$T6/main" rev-parse --show-toplevel)
O6=$(ctx "$T6/wt")
has   "worktree: bootstrap fires"            "$O6" "PROJECT BOOTSTRAP:"
has   "worktree: names the worktree root"    "$O6" "path=\"$WT6\""
hasnt "worktree: does not name main repo"    "$O6" "path=\"$MAIN6\""
rm -rf "$T6"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`
Expected: FAIL on every new assertion except the two `hasnt` cases (which pass vacuously — nothing is emitted to contain the wrong path). Failures read `FAIL [bootstrap: marker present]: exp=yes got=no`.

- [ ] **Step 3: Write minimal implementation**

In `subagent-guidance.mjs`, insert the root resolution after the gate block, then change `let msg = \`codescout EXPLORATION PROTOCOL…` to initialize empty and prepend the paragraph:

```javascript
// Project root for the bootstrap directive. Raw cwd is NOT sufficient: a cwd
// inside a worktree SUBDIRECTORY would not match .cs-worktree-pending's
// location (worktree-write-guard puts it at --show-toplevel; cs-activate-project
// deletes it via a literal join on tool_input.path), so the injected activate
// would be obeyed and still leave writes blocked.
const root = (cwd && git(cwd, ['rev-parse', '--show-toplevel'])) || cwd;

let msg = '';

// Soft-conditional on purpose: SubagentStart cannot see the dispatch prompt, so
// a foreign-targeted subagent (explore-inject prepended its own root directive
// to the prompt) must be able to override this. Do NOT "simplify" to an
// unconditional activate — that reintroduces the conflict.
if (root) {
  msg += `PROJECT BOOTSTRAP: unless the task below names a different project root, your
FIRST codescout action is workspace(action="activate", path="${root}") — it
prewarms LSP, auto-registers dependencies, and returns project_hints (primary
language, entry points, build commands). If the task DOES name another repo,
follow that directive instead and pin every call with workspace="<that root>".

`;
}

msg += `codescout EXPLORATION PROTOCOL — before exploring or auditing code:
```

The rest of the existing template literal is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`
Expected: PASS — 17 assertions, `Fail: 0.`

Run: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/subagent-guidance.mjs codescout-companion/hooks/subagent-guidance.test.sh
git commit -m "feat(codescout-companion): inject PROJECT BOOTSTRAP into subagents

Subagents on the home project never received the activate directive the
main agent gets at SessionStart. Adds a soft-conditional bootstrap
paragraph resolved via git rev-parse --show-toplevel — raw cwd would fail
to release .cs-worktree-pending from a worktree subdirectory.

Wording yields to the dispatch prompt so it cannot contradict
explore-inject's foreign-root directive.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fold memory topic names into Phase 0

Replaces Phase 0's `memory(action="list")` instruction with the actual topic names when they are known, eliminating a discovery round-trip per subagent. Falls back to today's wording verbatim when the project has no memories.

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` (Phase 0 first bullet)
- Modify: `codescout-companion/hooks/subagent-guidance.test.sh` (append Layer 4)

**Interfaces:**
- Consumes: `d.HAS_CS_MEMORIES` (`'true'`/`'false'` string) and `d.CS_MEMORY_NAMES` from `detectFor`. `CS_MEMORY_NAMES` is a space-separated list of `.md` basenames with the extension stripped, built by `detect.mjs` as `memoryNames += \`${name.slice(0,-3)} \`` — it therefore carries a **trailing space**.
- Produces: the discriminating header string `Memory topics available here:`.

- [ ] **Step 1: Write the failing test**

Insert into `subagent-guidance.test.sh`, immediately before the `echo "---"` summary block:

```bash
# ---------- 4. Phase 0 memory-name folding ----------
# Fixture memory names are SENTINELS on purpose: the fallback bullet's own text
# contains the words "architecture" and "gotchas", so asserting on those names
# would not discriminate between the two branches.

# Case 3: memories present → names inlined, no list round-trip.
T3=$(mktemp -d); mkdir -p "$T3/.codescout/memories"
: > "$T3/.codescout/memories/sentinel-alpha.md"
: > "$T3/.codescout/memories/sentinel-beta.md"
: > "$T3/.codescout/memories/notamemory.txt"   # non-.md must be ignored
O3=$(ctx "$T3")
has   "memories: inline header present"  "$O3" "Memory topics available here:"
has   "memories: names sentinel-alpha"   "$O3" "sentinel-alpha"
has   "memories: names sentinel-beta"    "$O3" "sentinel-beta"
hasnt "memories: strips .md extension"   "$O3" "sentinel-alpha.md"
hasnt "memories: ignores non-md files"   "$O3" "notamemory"
hasnt "memories: no list round-trip"     "$O3" 'memory(action="list")'
rm -rf "$T3"

# Case 4: no memories dir → fallback to today's wording verbatim.
T4=$(mktemp -d); mkdir -p "$T4/.codescout"
O4=$(ctx "$T4")
has   "no memories: falls back to list"     "$O4" 'memory(action="list")'
hasnt "no memories: no inline header"       "$O4" "Memory topics available here:"
rm -rf "$T4"

# Case 4b: memories dir exists but is empty → also fallback (HAS_CS_MEMORIES stays false).
T4B=$(mktemp -d); mkdir -p "$T4B/.codescout/memories"
O4B=$(ctx "$T4B")
has   "empty memories dir: falls back to list" "$O4B" 'memory(action="list")'
hasnt "empty memories dir: no inline header"   "$O4B" "Memory topics available here:"
rm -rf "$T4B"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`

Expected: FAIL on `memories: inline header present`, `memories: names sentinel-alpha`, `memories: names sentinel-beta`, and `memories: no list round-trip` — the hook still emits the static `memory(action="list")` bullet and never names topics. The three `hasnt` extension/non-md cases and both fallback cases should already PASS.

- [ ] **Step 3: Write minimal implementation**

In `subagent-guidance.mjs`, add the branch above the `let msg = ''` line:

```javascript
// Phase 0's memory bullet. When the topic names are already known, hand them
// over instead of telling the subagent to spend a call discovering them.
// CS_MEMORY_NAMES is space-separated with a trailing space — trim it.
const memoryBullet =
  d.HAS_CS_MEMORIES === 'true' && d.CS_MEMORY_NAMES
    ? `• Memory topics available here: ${d.CS_MEMORY_NAMES.trim()} — read the ones matching your task via memory(action="read", topic="…"); architecture and gotchas usually pay off. This is the complete list — don't call memory(action="list").`
    : `• memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).`;
```

Then, in the exploration-protocol template literal, replace the hardcoded first bullet:

```javascript
Phase 0 — load what the project already knows (do FIRST):
• memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).
```

with the interpolated one:

```javascript
Phase 0 — load what the project already knows (do FIRST):
${memoryBullet}
```

Leave Phase 0's remaining two bullets, Phases 1–2, and the report contract untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash codescout-companion/hooks/subagent-guidance.test.sh`
Expected: PASS — 28 assertions, `Fail: 0.`

Run: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/subagent-guidance.mjs codescout-companion/hooks/subagent-guidance.test.sh
git commit -m "feat(codescout-companion): fold memory topic names into Phase 0

Phase 0 told every subagent to call memory(action=\"list\") to discover
topic names detect.mjs already has in CS_MEMORY_NAMES. Hands the names
over inline instead, one source of truth, one fewer round-trip per
subagent. Falls back to the old wording when the project has no memories.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Manual verification, version bump, deploy

The suite proves output shape; this task proves the hook behaves correctly against the *real* project and ships it.

**Files:**
- Modify: `codescout-companion/.claude-plugin/plugin.json` (by `release.sh`)
- Modify: `README.md` version table (by `release.sh`)

**Interfaces:**
- Consumes: a green `./tests/run-all.sh` and a clean working tree (both are `release.sh` pre-flight gates).
- Produces: a new canonical version, seeded caches and repointed install records in all three profiles.

- [ ] **Step 1: Verify against the real project by hand**

```bash
printf '{"cwd":"%s","agent_type":"general-purpose","agent_id":"a1","session_id":"s1"}' \
  "$PWD" | node codescout-companion/hooks/subagent-guidance.mjs \
  | jq -r '.hookSpecificOutput.additionalContext'
```

Expected, read with your eyes (this is the real-config path, no force seam):
- Opens with `PROJECT BOOTSTRAP: unless the task below names a different project root,`
- Names this repo's absolute root in `path="…"`
- Phase 0's first bullet reads `Memory topics available here: agent-dispatch-hooks architecture conventions …` and does **not** contain `memory(action="list")`
- `CODESCOUT RULES` block still present
- The root `.codescout/system-prompt.md` content still appended at the end

- [ ] **Step 2: Confirm the foreign-dispatch path still reads coherently**

`explore-inject` writes the prompt while this hook writes `additionalContext`, so both directives coexist for a foreign-targeted subagent. Confirm the pairing is not self-contradictory:

```bash
bash codescout-companion/hooks/explore-inject.test.sh
```

Expected: `Fail: 0.` — then re-read this hook's `PROJECT BOOTSTRAP` first sentence and confirm it defers to the task text ("unless the task below names a different project root"). This is a judgment check, not an assertion; the automated guard for the wording is case 8.

- [ ] **Step 3: Dry-run the release**

```bash
NO_PUSH=1 ./scripts/release.sh codescout-companion patch
```

Expected: every gated step green — pre-flight (clean tree + `run-all.sh` + buddy pytest), `plugin.json` + README bump, `check-versions.sh`, `chore: bump …` commit, cache seeded in all three profiles, `installPath` + `version` repointed, sanity loop all ✅. Nothing pushed.

**STOP HERE and report to the user.** The remaining steps push to `origin/main` and mutate all three Claude Code profiles' install records — get explicit confirmation before proceeding.

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: The two steps `release.sh` cannot do**

Per `CLAUDE.md`:

1. Refresh the codescout `version-bump-checklist` tracker (needs the MCP tool, not bash), then verify every row is ✅ — any ❌ is real drift:

```
artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)
artifact(action="get",    id="cc8cb9e23ab5cc67", full=true)
```

2. **Cold-restart all three Claude Code instances** — `~/.claude`, `~/.claude-sdd`, `~/.claude-kat`. A `resume` is NOT enough: CC resolves hook commands and `installPath` at process launch and caches them, so a re-attach reuses the old in-memory hook and the new code never runs. Fully quit + relaunch, or `/reload-plugins`. Confirm via the `SessionStart` payload — a true cold start reports `source=startup`, a re-attach reports `source=resume`.

- [ ] **Step 6: Confirm live**

In a freshly cold-started session, dispatch any non-excluded subagent and confirm its context opens with `PROJECT BOOTSTRAP:` naming this repo's root, with topic names inline.

- [ ] **Step 7: Close the recon ledger entries**

Flip F-1, F-2, F-3 in `docs/trackers/subagent-bootstrap-session-log.md` from `open` to `fixed-verified`, and update the Index table rows.

```
artifact(action="update", id="9ea452e9cf4d9fbe", patch={body_edits: [...]})
```

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| Payload — message order, bootstrap paragraph | Task 2 |
| Payload — Phase 0 memory bullet, both branches | Task 3 |
| Payload — `CS_MEMORY_NAMES` space-separated, trailing space | Task 3 Step 3 (`.trim()`) |
| Root resolution — `--show-toplevel \|\| cwd` | Task 2 |
| Root resolution — empty root → omit paragraph, keep rest | Task 2 (`if (root)` guard) |
| Root resolution — `git` import extension | Task 1 Step 3 |
| Gates — `HAS_CODESCOUT`, three excluded `agent_type`s unchanged | Task 1 (cases 1, 2) |
| Gates — worktrees fire normally | Task 2 (case 6) |
| Gates — no per-session dedup | No task needed: nothing is added that dedups. Every `SubagentStart` emits. |
| Interaction — soft-conditional yields to prompt | Task 2 (case 8) + Task 4 Step 2 |
| Interaction — `explore-inject` idempotency unaffected | Task 4 Step 2 (its suite runs green) |
| Interaction — `session-start.mjs` not changed | No task touches it |
| Testing — seam, exemplar, all 8 cases | Tasks 1–3 |
| Testing — `detect.mjs` untouched, parity safe | Global Constraints; no task modifies it |
| Deploy — `release.sh` + tracker refresh + cold restart | Task 4 |

No gaps. Two additions beyond the spec's 8 cases, both cheap and worth keeping: a positive control in Task 1 (`general-purpose → emits`, so the exclusion-list cases cannot pass by the hook being globally silent) and case 4b in Task 3 (empty memories dir, which exercises the `HAS_CS_MEMORIES` computation rather than just the missing-dir path).

**2. Placeholder scan.** No `TBD`/`TODO`/"similar to Task N"/"add error handling". Every code step carries literal code. Task 4's steps 1–2 are human-judgment verifications and say so explicitly rather than pretending to be assertions.

**3. Type consistency.**
- `CS_SUBAGENT_GUIDANCE_FORCE` — spelled identically in Task 1 Step 3, the test `ctx()` helper, and the spec.
- `memoryBullet` — declared in Task 3 Step 3, consumed in the same step's template literal.
- `root` — declared Task 2 Step 3, used in the same paragraph.
- `git(cwd, args)` — imported Task 1 Step 3, called Task 2 Step 3, signature matches `lib.mjs` (returns `string | null`).
- Shell helpers `ok`/`has`/`hasnt`/`ctx`/`raw` — defined Task 1, used unchanged in Tasks 2–3.
- Assertion counts (8 → 17 → 28) are cumulative and consistent with the cases each task appends.

One consistency risk worth flagging for the implementer: Tasks 2 and 3 both insert their test blocks "immediately before the `echo \"---\"` summary block". Executed in order this is unambiguous, but if the tasks are done out of order the blocks land in a different sequence. Order does not affect correctness — each block is self-contained with its own fixture setup and teardown.
