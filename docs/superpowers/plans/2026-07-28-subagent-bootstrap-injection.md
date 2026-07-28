# Subagent Bootstrap Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the `PROJECT BOOTSTRAP` triad (activate directive + inline memory topic names) to every codescout subagent via the `SubagentStart` hook.

**Architecture:** One behavior change to `codescout-companion/hooks/subagent-guidance.mjs` — prepend a soft-conditional activate paragraph resolved to the git toplevel, and fold `CS_MEMORY_NAMES` into the exploration protocol's Phase 0 bullet, replacing its `memory(action="list")` instruction. Tests live in `tests/test-subagent-guidance.sh` — the suite that **already exists** and already drives this hook — extended using the `tests/lib/fixtures.sh` helper library. Gate control is per-project and environment-sealed via `write_routing_config`; no production code exists for testability.

**Tech Stack:** Node ESM (`.mjs`, no dependencies), bash + `jq` test harness, `git` CLI for root resolution.

**Spec:** `docs/superpowers/specs/2026-07-28-subagent-bootstrap-injection-design.md`
**Recon findings this plan encodes:** F-1, F-2, F-3 in `docs/trackers/subagent-bootstrap-session-log.md`

## Global Constraints

> **Amended 2026-07-28** after Task 1's review. Two original premises were false:
> `subagent-guidance.mjs` *does* already have a test suite (`tests/test-subagent-guidance.sh`),
> and a per-project fixture *can* control the codescout gate — so the
> `CS_SUBAGENT_GUIDANCE_FORCE` seam this plan originally mandated is unnecessary and
> has been reverted. See the ledger and R-2 in `docs/trackers/reconnaissance-patterns.md`.

- **Fail-open contract** (`hooks/lib.mjs` header): hooks MUST exit 0 even on error. A non-zero `PreToolUse` exit is itself a deny on Copilot CLI. Never let a crash block a user's tool.
- **Node-only.** No bash, no `jq`, no Python inside hook `.mjs` files — they must run on Windows and under GitHub Copilot without Git Bash.
- **No production code exists solely for tests.** Gate control comes from fixtures, not from an env seam in the hook.
- **`jq` is a required dependency** for test scripts (not for hooks).
- **Config dir resolution:** always `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, never bare `$HOME/.claude`.
- **Test isolation** (`CLAUDE.md`): every test that writes config/files/env must remove them before the next test runs.
- **`tests/run-all.sh` globs BOTH** `tests/test-*.sh` **and** `codescout-companion/hooks/*.test.sh`. Neither needs registration. (The original plan named only the second glob — that omission is why the existing suite was missed.)
- **Do not modify `detect.mjs`.** It is held at byte-parity with `scripts/detect.py` by `detect.test.sh`.

### Gate control — verified empirically, use exactly this

`HAS_CODESCOUT` is resolved by `detect.mjs` in this order: routing-config `server_name`
override → `<cwd>/.mcp.json` → user-level `<claudeDir>/.claude.json`,
`<claudeDir>/settings.json`, `~/.claude.json` (the last only when `CLAUDE_CONFIG_DIR`
is unset).

**To OPEN the gate deterministically** (per-project, environment sealed):

```bash
write_routing_config "$DIR" '{"server_name":"codescout"}'
# then invoke with: HOME="$T" CLAUDE_CONFIG_DIR="$T/empty"
```

Verified: `HAS_CODESCOUT=true`, `CS_SERVER_NAME=codescout`, `CS_PREFIX=mcp__codescout__`.

**To CLOSE the gate deterministically:** seal `HOME` and `CLAUDE_CONFIG_DIR` to empty
dirs, and write no routing config. Sealing `CLAUDE_CONFIG_DIR` is what removes the
`~/.claude.json` path.

**`write_mcp_json` is a TRAP — do not use it for gate control.** Verified:
`HAS_CODESCOUT=false`. `serverNameFromMcpConfig` matches `/codescout/` against the
server's `command`/`args`, and that fixture writes `command: <dir>/fake-ce`, which does
not match. The server *key* is not consulted. Every existing test that relies on it for
an open gate is passing for the wrong reason.

**Always seal `HOME` + `CLAUDE_CONFIG_DIR` on every hook invocation.** An unsealed call
reads the developer's real config, so it passes on a configured box and fails on CI —
the inverted flake this plan's F-2 was written to prevent.
---

## File Structure

| File | Responsibility |
|---|---|
| `codescout-companion/hooks/subagent-guidance.mjs` | **Modify.** The only behavior change. Adds root resolution, the bootstrap paragraph, and the Phase 0 memory bullet branch. |
| `tests/test-subagent-guidance.sh` | **Modify.** The canonical suite — it already existed and already drives this hook. All new cases land here, using `tests/lib/fixtures.sh` helpers. |
| `codescout-companion/hooks/subagent-guidance.test.sh` | **Delete** (Task 1). Created in error on the false premise that no suite existed; duplicates the canonical one. |
| `codescout-companion/.claude-plugin/plugin.json` | **Modify (Task 4).** Version bump — canonical source of truth. |
| `README.md` | **Modify (Task 4).** Version table, updated by `release.sh`. |

No `hooks.json` change: `SubagentStart` → `subagent-guidance.mjs` is already registered.

**Fixture helpers available** in `tests/lib/fixtures.sh` — source it; it also exports
`HOOK_DIR`, `pass`, `fail`, `print_summary`, `assert_context_contains`,
`assert_no_output`. Setup helpers: `make_git_repo`, `make_worktree`,
`write_routing_config`, `make_memories` (writes `arch.md` + `patterns.md`),
`make_system_prompt` (writes `SYSTEM PROMPT CONTENT`), `make_codescout_dir`.

---

### Task 1: Revert the seam; make the canonical suite deterministic

**Amended.** The original Task 1 built a new colocated suite and an env seam, both on
the false premise that no suite existed. Revert both, and fix the two real defects in
the suite that *does* exist: its exclusion cases are vacuous, and one case reads the
developer's ambient config.

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` — revert the gate to its original bare form; keep only the `git` import (Task 2 consumes it)
- Delete: `codescout-companion/hooks/subagent-guidance.test.sh`
- Modify: `tests/test-subagent-guidance.sh` — seal the environment, open the gate with `write_routing_config`, add the missing exclusion case and a positive control

**Interfaces:**
- Consumes: `tests/lib/fixtures.sh` — `HOOK_DIR`, `make_git_repo`, `write_routing_config`, `make_system_prompt`, `assert_no_output`, `assert_context_contains`, `pass`, `fail`, `print_summary`.
- Produces: the `run_hook <cwd> <agent_type>` helper and the sealed-env convention (`HOME="$T" CLAUDE_CONFIG_DIR="$T/empty"`) that Tasks 2 and 3 reuse for every case they add.

- [ ] **Step 1: Revert Task 1's production change**

In `codescout-companion/hooks/subagent-guidance.mjs`, restore the gate to exactly:

```javascript
const cwd = input.cwd || '';
const d = detectFor(cwd);
if (d.HAS_CODESCOUT === 'false') process.exit(0);
```

Keep the `git` import (Task 2 needs it):

```javascript
import { readInput, detectFor, git, emit } from './lib.mjs';
```

Remove the `Testing seam: CS_SUBAGENT_GUIDANCE_FORCE=1 …` line from the header comment. Leave the rest of the header's description of what the hook delivers.

Then delete the duplicate suite:

```bash
git rm codescout-companion/hooks/subagent-guidance.test.sh
```

- [ ] **Step 2: Rewrite `tests/test-subagent-guidance.sh`**

Replace the whole file. Two defects are being fixed: `write_mcp_json` does **not** open
the gate (verified `HAS_CODESCOUT=false` — `detect.mjs` matches `/codescout/` against the
server command/args, and that fixture writes `command: <dir>/fake-ce`), so the old
Bash/statusline cases proved nothing; and the old Test 4 omitted the env override, so it
passed only on a machine with codescout configured.

```bash
#!/bin/bash
# tests/test-subagent-guidance.sh
#
# Gate control is per-project + environment-sealed:
#   OPEN  → write_routing_config with an explicit server_name
#   CLOSE → seal HOME + CLAUDE_CONFIG_DIR, write no routing config
# Do NOT use write_mcp_json to open the gate: detect.mjs matches /codescout/
# against the server command/args, and that fixture's command is <dir>/fake-ce,
# so it leaves HAS_CODESCOUT=false. Every invocation seals HOME and
# CLAUDE_CONFIG_DIR — an unsealed call reads the developer's real config and
# passes on a configured box while failing on CI.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── subagent-guidance ──"
HOOK="$HOOK_DIR/subagent-guidance.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/empty"

# Gate OPEN for $T/proj.
make_git_repo "$T/proj"
write_routing_config "$T/proj" '{"server_name":"codescout"}'

# Gate CLOSED for $T/bare (git repo, no routing config).
make_git_repo "$T/bare"

# run_hook <cwd> <agent_type> → raw stdout, env sealed so only the fixture decides.
run_hook() {
  printf '{"cwd":"%s","agent_type":"%s","agent_id":"a1","session_id":"s1"}' "$1" "$2" \
    | HOME="$T" CLAUDE_CONFIG_DIR="$T/empty" node "$HOOK" 2>/dev/null
}

# --- Exclusions. Gate is OPEN, so silence proves the exclusion, not the gate. ---
for at in Bash statusline-setup claude-code-guide; do
  OUT=$(run_hook "$T/proj" "$at")
  if assert_no_output "$OUT"; then pass "$at agent: silent exit"
  else fail "$at agent: silent exit" "$OUT"; fi
done

# --- Positive control: without it, every exclusion case above could pass by
# --- the hook being globally silent.
OUT=$(run_hook "$T/proj" "general-purpose")
if [ -n "$OUT" ]; then pass "general-purpose + gate open: emits"
else fail "general-purpose + gate open: emits" "(empty)"; fi
if assert_context_contains "$OUT" "codescout EXPLORATION PROTOCOL"; then
  pass "emits the exploration protocol"
else fail "emits the exploration protocol" "$OUT"; fi
if assert_context_contains "$OUT" "CODESCOUT RULES"; then
  pass "emits the codescout rules"
else fail "emits the codescout rules" "$OUT"; fi

# --- Gate CLOSED → silent, with the environment sealed (not ambient config). ---
OUT=$(run_hook "$T/bare" "general-purpose")
if assert_no_output "$OUT"; then pass "gate closed: silent exit"
else fail "gate closed: silent exit" "$OUT"; fi

# --- System prompt appended verbatim (gate open). ---
make_system_prompt "$T/proj"
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "system prompt appended"
else fail "system prompt appended" "$OUT"; fi

print_summary "subagent-guidance"
```

- [ ] **Step 3: Prove each new assertion discriminates**

An assertion that passes whether or not the behavior exists is worthless. Verify two by
temporary mutation, then revert each:

```bash
# 1. Exclusions really are what silences those three agent types:
#    comment out the agentType early-return in subagent-guidance.mjs, re-run.
#    Expected: the three "silent exit" cases FAIL. Then restore.
# 2. The gate-closed case really depends on the seal:
#    drop CLAUDE_CONFIG_DIR from run_hook, re-run.
#    Expected on this machine: "gate closed: silent exit" FAILS (ambient config
#    opens the gate). Then restore.
bash tests/test-subagent-guidance.sh
```

Record both mutation results in your report. If a mutation does **not** flip the
expected case to FAIL, the assertion is vacuous — say so rather than proceeding.

- [ ] **Step 4: Run the suites**

Run: `bash tests/test-subagent-guidance.sh`
Expected: `subagent-guidance: 8 passed, 0 failed` (3 exclusions + 3 positive-control
assertions + gate-closed + system-prompt)

Run: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add -A codescout-companion/hooks/subagent-guidance.mjs tests/test-subagent-guidance.sh
git rm --cached codescout-companion/hooks/subagent-guidance.test.sh 2>/dev/null; true
git commit -m "test(codescout-companion): make subagent-guidance suite deterministic

Reverts the CS_SUBAGENT_GUIDANCE_FORCE seam and the duplicate colocated
suite, both added on a false premise: tests/test-subagent-guidance.sh
already existed, and write_routing_config already controls the gate
per-project with the environment sealed. No production code for tests.

Fixes two real defects in the existing suite: it used write_mcp_json to
open the gate, which leaves HAS_CODESCOUT=false (detect matches
/codescout/ against the server command, not its key), so the exclusion
cases proved nothing; and its system-prompt case omitted the env
override, passing only where codescout is configured.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
---

### Task 2: Bootstrap paragraph with git-toplevel root resolution

Adds the activate directive. Root resolution is a correctness requirement: `worktree-write-guard.mjs` places `.cs-worktree-pending` at `git rev-parse --show-toplevel`, and `cs-activate-project.mjs` releases it with a literal `join(tool_input.path, '.cs-worktree-pending')` — so `activate(path=cwd)` from a worktree *subdirectory* would never release the guard.

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` (root resolution + `msg` initialization)
- Modify: `tests/test-subagent-guidance.sh` (append cases)

**Interfaces:**
- Consumes: `git(cwd, args)` from `./lib.mjs` — returns trimmed stdout, or `null` on error/non-zero exit; imported in Task 1. From the suite: `run_hook`, the sealed-env convention, `write_routing_config`, `make_git_repo`, `make_worktree`, `assert_context_contains`.
- Produces: the literal marker `PROJECT BOOTSTRAP:` and the substring `path="<root>"` in `additionalContext`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test-subagent-guidance.sh`, immediately before `print_summary`:

```bash
# --- Bootstrap paragraph. $T/proj is a git repo, so root == its toplevel. ---
PROJ_ROOT=$(git -C "$T/proj" rev-parse --show-toplevel)
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "PROJECT BOOTSTRAP:"; then
  pass "bootstrap: marker present"
else fail "bootstrap: marker present" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  pass "bootstrap: names the project root"
else fail "bootstrap: names the project root" "$OUT"; fi
if assert_context_contains "$OUT" "unless the task below names a different project root"; then
  pass "bootstrap: soft-conditional wording present"
else fail "bootstrap: soft-conditional wording present" "$OUT"; fi

# --- cwd is a SUBDIRECTORY → must name the toplevel, not the subdir. A subdir
# --- path would not match .cs-worktree-pending's location and so would never
# --- release worktree-write-guard.
mkdir -p "$T/proj/nested/deeper"
# The subdir needs its OWN routing config: detect.mjs's findRoutingConfig is
# cwd-only with no upward walk, so without this the gate is CLOSED here, the
# hook exits before the root-resolution code runs, and this block stops
# discriminating anything. It is the ONLY discriminator for the git-toplevel
# requirement — the worktree block passes even under `root = cwd`, because a
# worktree's cwd already equals its toplevel.
write_routing_config "$T/proj/nested/deeper" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/proj/nested/deeper" "general-purpose")
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  pass "subdir cwd: names repo toplevel"
else fail "subdir cwd: names repo toplevel" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$T/proj/nested/deeper\""; then
  fail "subdir cwd: must NOT name the subdir" "$OUT"
else pass "subdir cwd: does not name the subdir"; fi

# --- Worktree cwd → fires, and names the WORKTREE root, not the main repo.
# --- The worktree needs its own routing config: detect reads it from cwd.
make_worktree "$T/proj" "$T/wt"
write_routing_config "$T/wt" '{"server_name":"codescout"}'
WT_ROOT=$(git -C "$T/wt" rev-parse --show-toplevel)
OUT=$(run_hook "$T/wt" "general-purpose")
if assert_context_contains "$OUT" "PROJECT BOOTSTRAP:"; then
  pass "worktree: bootstrap fires"
else fail "worktree: bootstrap fires" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$WT_ROOT\""; then
  pass "worktree: names the worktree root"
else fail "worktree: names the worktree root" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  fail "worktree: must NOT name the main repo" "$OUT"
else pass "worktree: does not name the main repo"; fi
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash tests/test-subagent-guidance.sh`
Expected: `10 passed, 6 failed`. The 6 FAILs are exactly the 6 positive assertions (`bootstrap: marker present`, `names the project root`, `soft-conditional wording present`, `subdir cwd: names repo toplevel`, `worktree: bootstrap fires`, `worktree: names the worktree root`). The 2 negative assertions (`subdir cwd: does not name the subdir`, `worktree: does not name the main repo`) pass **vacuously** — nothing is emitted to contain a wrong path. This block defines 8 new assertions, 6 positive and 2 negative. Report which were vacuous rather than reporting a clean red.

- [ ] **Step 3: Write minimal implementation**

In `subagent-guidance.mjs`, insert after the gate block, then change `let msg = \`codescout EXPLORATION PROTOCOL…` to initialize empty and prepend:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash tests/test-subagent-guidance.sh`
Expected: `subagent-guidance: 16 passed, 0 failed`

Run: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/subagent-guidance.mjs tests/test-subagent-guidance.sh
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
- Modify: `tests/test-subagent-guidance.sh` (append cases)

**Interfaces:**
- Consumes: `d.HAS_CS_MEMORIES` (`'true'`/`'false'` string) and `d.CS_MEMORY_NAMES` from `detectFor`. `CS_MEMORY_NAMES` is a space-separated list of `.md` basenames with the extension stripped, built as `memoryNames += \`${name.slice(0,-3)} \`` — it therefore carries a **trailing space**. From the suite: `run_hook`, `make_memories`, `write_routing_config`, `make_git_repo`.
- Produces: the discriminating header string `Memory topics available here:`.

- [ ] **Step 1: Write the failing tests**

`make_memories` writes `arch.md` and `patterns.md`. **Assert on `patterns`, never on
`arch`** — `arch` is a substring of the word "architecture", which appears in the
*fallback* bullet's own text, so an `arch` assertion would pass in both branches and
discriminate nothing. `patterns` appears nowhere in the static message.

Append to `tests/test-subagent-guidance.sh`, immediately before `print_summary`:

```bash
# --- Memories present → names inlined, no list round-trip. Assert on
# --- "patterns", NOT "arch": "arch" is a substring of "architecture" which the
# --- fallback bullet itself contains, so it would not discriminate.
make_memories "$T/proj"
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "Memory topics available here:"; then
  pass "memories: inline header present"
else fail "memories: inline header present" "$OUT"; fi
if assert_context_contains "$OUT" "patterns"; then
  pass "memories: names the topics"
else fail "memories: names the topics" "$OUT"; fi
if assert_context_contains "$OUT" "patterns.md"; then
  fail "memories: must strip the .md extension" "$OUT"
else pass "memories: strips the .md extension"; fi
# --- The literal substring memory(action="list") is REQUIRED in the fallback
# --- branch and FORBIDDEN in the inline branch, so asserting on that literal
# --- is a tripwire in both directions (any rewording of either branch's
# --- "don't call list" phrasing evades a substring check trivially). Assert
# --- instead on the fallback bullet's own distinctive phrase, which is unique
# --- to that branch and appears nowhere in the inline bullet: this tests that
# --- the inline bullet REPLACED the fallback rather than being appended
# --- alongside it, which is the behavior that actually matters here.
if assert_context_contains "$OUT" "then read the topics matching your task"; then
  fail "memories: inline bullet must replace the fallback, not append to it" "$OUT"
else pass "memories: inline bullet replaces the fallback"; fi

# --- No memories → fallback to today's wording verbatim. $T/nomem is a separate
# --- fixture so the memories written above cannot leak into it.
make_git_repo "$T/nomem"
write_routing_config "$T/nomem" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/nomem" "general-purpose")
if assert_context_contains "$OUT" 'memory(action="list")'; then
  pass "no memories: falls back to list"
else fail "no memories: falls back to list" "$OUT"; fi
if assert_context_contains "$OUT" "Memory topics available here:"; then
  fail "no memories: must NOT emit the inline header" "$OUT"
else pass "no memories: no inline header"; fi
# --- Pin the sentinel phrase at its source: the "inline bullet replaces the
# --- fallback" case above depends on "then read the topics matching your
# --- task" being unique to the fallback bullet, but nothing yet asserts that
# --- phrase is actually PRESENT there — assert it here, on the fallback
# --- branch itself, so a fallback reword can't silently disarm that case.
if assert_context_contains "$OUT" "then read the topics matching your task"; then
  pass "no memories: fallback sentinel phrase present"
else fail "no memories: fallback sentinel phrase present" "$OUT"; fi

# --- Empty memories dir → also fallback. Exercises HAS_CS_MEMORIES' computation
# --- rather than only the missing-directory path.
make_git_repo "$T/emptymem"
write_routing_config "$T/emptymem" '{"server_name":"codescout"}'
mkdir -p "$T/emptymem/.codescout/memories"
OUT=$(run_hook "$T/emptymem" "general-purpose")
if assert_context_contains "$OUT" 'memory(action="list")'; then
  pass "empty memories dir: falls back to list"
else fail "empty memories dir: falls back to list" "$OUT"; fi
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash tests/test-subagent-guidance.sh`
Expected: FAIL on `memories: inline header present`, `memories: names the topics`, and `memories: inline bullet replaces the fallback` — the hook still emits the static bullet unconditionally, so it never names topics and never replaces itself. The `.md`-stripping case, both no-memories cases, and `no memories: fallback sentinel phrase present` pass already (the static bullet already contains the sentinel phrase, memories or not). Note which passed pre-implementation in your report.

- [ ] **Step 3: Write minimal implementation**

In `subagent-guidance.mjs`, add above the `let msg = ''` line:

```javascript
// Phase 0's memory bullet. When the topic names are already known, hand them
// over instead of telling the subagent to spend a call discovering them.
// CS_MEMORY_NAMES is space-separated with a trailing space — trim it, and guard
// on the TRIMMED value: a memory file named " .md" makes detect report
// HAS_CS_MEMORIES=true with whitespace-only names, which would otherwise emit a
// bullet naming nothing. detect.mjs is parity-locked, so the guard lives here.
//
// The closing clause deliberately avoids the literal memory(action="list"):
// naming the call you don't want made puts it in front of the model, and the
// fallback branch below must contain that literal, so no substring assertion
// can police both branches.
const memoryNames = (d.CS_MEMORY_NAMES || '').trim();
const memoryBullet =
  d.HAS_CS_MEMORIES === 'true' && memoryNames
    ? `• Memory topics available here: ${memoryNames} — read the ones matching your task via memory(action="read", topic="…"); architecture and gotchas usually pay off. This is the complete list, so skip the separate discovery call.`
    : `• memory(action="list"), then read the topics matching your task (architecture, gotchas usually pay off).`;
```

Then in the exploration-protocol template literal, replace the hardcoded first bullet:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash tests/test-subagent-guidance.sh`
Expected (as authored, before later hardening): `subagent-guidance: 24 passed, 0 failed`
(16 after Task 2, plus this task's 8 — the `no memories: fallback sentinel phrase
present` case above, not the retired `no list round-trip` one, is the 8th). The suite was
hardened further after this task shipped (the sentinel-phrase replacement above, plus
later review rounds); as of this plan's final state it reports `subagent-guidance: 34
passed, 0 failed` — treat that number, not this one, as current. Run `bash
tests/test-subagent-guidance.sh` for the live count rather than trusting either figure.

Run: `./tests/run-all.sh`
Expected: `✓ All suites passed.`

- [ ] **Step 5: Commit**

```bash
git add codescout-companion/hooks/subagent-guidance.mjs tests/test-subagent-guidance.sh
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
| Testing — canonical suite, fixture gate control, all cases | Tasks 1–3 |
| Testing — `detect.mjs` untouched, parity safe | Global Constraints; no task modifies it |
| Deploy — `release.sh` + tracker refresh + cold restart | Task 4 |

No gaps. Two additions beyond the spec's 8 cases, both cheap and worth keeping: a positive control in Task 1 (`general-purpose → emits`, so the exclusion-list cases cannot pass by the hook being globally silent) and case 4b in Task 3 (empty memories dir, which exercises the `HAS_CS_MEMORIES` computation rather than just the missing-dir path).

**2. Placeholder scan.** No `TBD`/`TODO`/"similar to Task N"/"add error handling". Every code step carries literal code. Task 4's steps 1–2 are human-judgment verifications and say so explicitly rather than pretending to be assertions.

**3. Type consistency.**
- `write_routing_config "$DIR" '{"server_name":"codescout"}'` — the open-gate idiom, spelled identically in Global Constraints, Tasks 1–3, and the spec. `write_mcp_json` appears nowhere as a gate-control call.
- `memoryBullet` — declared in Task 3 Step 3, consumed in the same step's template literal.
- `root` — declared Task 2 Step 3, used in the same paragraph.
- `git(cwd, args)` — imported Task 1 Step 3, called Task 2 Step 3, signature matches `lib.mjs` (returns `string | null`).
- Shell helper `run_hook <cwd> <agent_type>` — defined Task 1, used unchanged in Tasks 2–3. Assertion helpers come from `tests/lib/fixtures.sh` (`assert_no_output`, `assert_context_contains`, `pass`, `fail`, `print_summary`), not from bespoke definitions.
- Assertion counts (8 → 16 → 24 as authored) are cumulative and consistent with the cases each task appends: Task 1 leaves 8 (3 exclusions + 3 positive-control + gate-closed + system-prompt), Task 2 adds 8, Task 3 adds 8 (not 7 — see Task 3 Step 4: the sentinel-phrase replacement for the retired `no list round-trip` case nets one extra case, `no memories: fallback sentinel phrase present`). The suite has been hardened further since this plan was authored (the sentinel-phrase fix itself, plus later review rounds) and no longer matches this arithmetic — run `bash tests/test-subagent-guidance.sh` for the live count rather than deriving it from this table.

One consistency risk worth flagging for the implementer: Tasks 2 and 3 both insert their test blocks "immediately before the `print_summary` call". Executed in order this is unambiguous, but if the tasks are done out of order the blocks land in a different sequence. Order does not affect correctness — each block is self-contained with its own fixture setup and teardown.
