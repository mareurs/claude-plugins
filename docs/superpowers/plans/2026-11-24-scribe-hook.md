# Scribe hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PreToolUse hook in codescout-companion refuses the main agent's first `codescout box` write in a window, once, and names the scribe recipe, so the agent hands tracker edits to a background fork.

**Architecture:** One pure module (`scribe-rules.mjs`: verb detector and message) and one thin hook (`scribe-nudge.mjs`: gates, marker, deny). The hook reads `tool_input.command` of `Bash` and `mcp__codescout__run_command`. The scribe fork carries `agent_id` and is never refused. The `scribe` guide (branch `scribe-fork` in the codescout repository) is the fork's payload.

**Tech Stack:** Node ESM hooks, `node:test`, the `lib.mjs` helpers, bash and a headless `claude -p` for acceptance.

**Spec:** `/home/marius/work/claude/codescout.worktrees/scribe-fork/docs/superpowers/specs/2026-11-24-scribe-fork-design.md` (codescout repository, branch `scribe-fork`; read § Design "The trigger", § Budgets and tests, § Result).

## Global Constraints

- **Develop in a linked worktree of this repository.** Hooks load from the repository working tree and edits are live at once (`CLAUDE.md` § Plugin Install Path): an unfinished deny hook in the main checkout would refuse live sessions. Merge to `main` only when Task 3 passes.
- The `hooks.json` command string must match `^node \${CLAUDE_PLUGIN_ROOT}/hooks/.+\.mjs$` with no `args` (`tests/test-hooks-json-registration.sh`).
- A hook exits 0 on every path and fails open: an error, a missing field or a failed marker write lets the call through (`lib.mjs` FAIL-OPEN CONTRACT).
- The message states the current situation only, no history, at most 320 bytes.
- Claude Code only. `CS_SCRIBE_NUDGE=false` disables the hook.
- The write verbs are exactly `add`, `now`, `edit`, `close`, `promote`, `end`, `supersede`, `reaffirm` and `note` (the verb of the frictions inbox, added after the replay). `new`, `flush`, `list`, `show`, `find`, `check`, `decisions`, `timeline`, `help` and a bare `codescout box` are not writes, and neither is any call with `--help` or `-h`.
- Do not import `door-shell-guard.mjs`: it reads stdin at load. Its quote rules (`isQuotedAt`, the heredoc opener) are the reference to match.
- Commit with explicit paths. Run `./tests/run-all.sh` before Task 3 ends, and report every failure by name, including ones that were red before.

## Review Focus

1. The hook refuses the scribe fork itself (a fork payload has `agent_id`). Pinned by Task 2's `agent_id` test and Task 3's fork-commit check.
2. The verb detector misfires: a quoted or heredoc mention denied, or a real write missed when flags precede the verb or the binary has a path prefix. Pinned by Task 1's table.
3. The hook refuses every box write forever: a marker that is never set, or a failed marker write that denies each call. Pinned by Task 2's marker tests and its fail-open test.
4. The window is wrong: a repeat denied inside it, or no new refusal after it. Pinned by Task 2's window tests.
5. The message drifts from the real recipe or grows past 320 bytes. Pinned by Task 1's message test.

---

### Task 1: The verb detector and the message

**Files:**
- Create: `codescout-companion/hooks/scribe-rules.mjs`
- Test: `codescout-companion/hooks/scribe-rules.test.mjs` (picked up by `tests/run-all.sh`)

**Interfaces:**
- Produces: `export const WRITE_VERBS: string[]`; `export function boxWriteVerb(command: string): string | null`, the first write verb of an unquoted `codescout box` invocation, else `null`; `export const SCRIBE_MESSAGE: string`. Task 2 consumes all three.

- [ ] **Step 1: Write the failing tests** in `scribe-rules.test.mjs` (`node:test`, `node:assert/strict`):
  - `boxWriteVerb` returns the verb for: `codescout box bugs add --title "x"` (`add`); `codescout box add --title x` (`add`, root ledger); `codescout box --project /r bugs close k fixed` (`close`); `codescout box --json bugs promote k --to other` (`promote`); `/usr/local/bin/codescout box bugs edit k '{}'` (`edit`); `cd d && codescout box bugs now k --text body -` (`now`); `codescout box bugs end`, `... supersede k`, `... reaffirm k`; `codescout box bugs add --title x | tee out` (`add`).
  - It returns `null` for: `codescout box`, `codescout box bugs list`, `... show k`, `... find x`, `... help close`, `... check`, `codescout box new bugs --title x`, `codescout box flush`, `codescout box decisions`, `codescout doc create`, `echo "codescout box bugs add"`, `git commit -m 'codescout box add x'`, `grep -r "codescout box close" docs`, and a command whose heredoc body holds `codescout box bugs add` after `cat <<'EOF'`.
  - `SCRIBE_MESSAGE` has `Buffer.byteLength <= 320`, contains `subagent_type="fork"`, `get_guide('scribe')` and `repeat this call`, and none of `was removed`, `formerly`, `no longer`.

- [ ] **Step 2: Run and watch it fail.**
  Run: `node --test codescout-companion/hooks/scribe-rules.test.mjs`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `scribe-rules.mjs`: strip heredoc bodies, find `codescout` words at unquoted positions (a path prefix is allowed), require the next word to be `box`, skip `--project <value>` and `--json`/`--help`-style flags, skip a box key (the first non-flag word that is not a verb), and return the verb if it is in `WRITE_VERBS`. The message text is: `A scribe fork can file this tracker edit while you keep working: Agent(subagent_type="fork", prompt="Scribe: <what to file, which box>. Read get_guide('scribe')."). For a one-line note, repeat this call: it passes.`

- [ ] **Step 4: Run and watch it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add -- <the two files>`, then `git commit -m "feat(companion): box write verb detector and the scribe message" -- <the two files>`.

### Task 2: The hook and its registration

**Files:**
- Create: `codescout-companion/hooks/scribe-nudge.mjs`
- Modify: `codescout-companion/hooks/hooks.json` (one PreToolUse entry)
- Test: `codescout-companion/hooks/scribe-nudge.test.mjs`

**Interfaces:**
- Consumes: `boxWriteVerb`, `SCRIBE_MESSAGE` (Task 1); `readInput`, `denyPreToolUse`, `sanitizeSessionId`, `shortHash` from `lib.mjs`.
- Produces: the registered hook. Env knobs for tests: `CS_SCRIBE_STATE_DIR` (marker directory, default `os.tmpdir()`), `CS_SCRIBE_WINDOW_MS` (default 1800000).

- [ ] **Step 1: Write the failing tests** in `scribe-nudge.test.mjs`. Each test runs `node scribe-nudge.mjs` as a child process with a JSON payload on stdin, a fresh `CS_SCRIBE_STATE_DIR`, and asserts on stdout. The payload is `{ session_id, cwd, tool_name, tool_input: { command } }`.
  - Main agent, `Bash`, `codescout box bugs add --title x`: stdout is JSON with `permissionDecision: "deny"` and a reason containing `get_guide('scribe')`.
  - Same with `tool_name: "mcp__codescout__run_command"`: deny.
  - The same payload a second time: empty stdout (the marker passes the repeat).
  - A payload with `agent_id: "a1"`: empty stdout, and no marker file is written.
  - `codescout box bugs list`, a non-box command, a tool name `Read`, empty or invalid stdin: empty stdout.
  - `CS_SCRIBE_NUDGE=false`: empty stdout.
  - A different `session_id`: denied again (the marker is per session).
  - The window: with `CS_SCRIBE_WINDOW_MS=1`, a short sleep and the same payload: denied again.
  - Fail open: `CS_SCRIBE_STATE_DIR` names a path that cannot be written: empty stdout, exit code 0.
  - Every case exits with code 0.

- [ ] **Step 2: Run and watch it fail.**
  Run: `node --test codescout-companion/hooks/scribe-nudge.test.mjs`
  Expected: FAIL (script missing).

- [ ] **Step 3: Implement** `scribe-nudge.mjs`. Gate order: no input, `CS_SCRIBE_NUDGE=false`, a tool name other than `Bash` and `mcp__codescout__run_command`, an `agent_id`, no write verb: each exits 0 silently. Then claim the marker `join(stateDir, 'cs-scribe-' + shortHash(sanitizeSessionId(session_id)))`: when it exists and its mtime is inside the window, exit 0. Otherwise write it, then `denyPreToolUse(SCRIBE_MESSAGE)`. Any thrown error exits 0. Add to `hooks.json` under `PreToolUse`: matcher `Bash|mcp__codescout__run_command`, command `node ${CLAUDE_PLUGIN_ROOT}/hooks/scribe-nudge.mjs`.

- [ ] **Step 4: Run and watch it pass.**
  Run: `node --test codescout-companion/hooks/scribe-nudge.test.mjs && bash tests/test-hooks-json-registration.sh && bash tests/test-hook-permissions.sh`
  Expected: PASS.

- [ ] **Step 5: Commit.** `git add -- <the three files>`, then commit those paths: `feat(companion): scribe-nudge refuses the first box write once and names the scribe`.

### Task 3: Acceptance, docs and the Result

**Files:**
- Modify: `CLAUDE.md` (one bullet under § codescout-companion "What it does")
- Modify: `/home/marius/work/claude/codescout.worktrees/scribe-fork/docs/superpowers/specs/2026-11-24-scribe-fork-design.md` (append `## Result — hook`; a separate commit in that repository)
- Uses: `tests/acceptance/scribe-fork/run.sh`, `score.py`

- [ ] **Step 1: Document** the hook in `CLAUDE.md`: one bullet, "PreToolUse `scribe-nudge.mjs`: refuses the main agent's first `codescout box` write in 30 minutes once, naming the scribe fork recipe; `CS_SCRIBE_NUDGE=false` disables it." Commit that path.

- [ ] **Step 2: Run the suite.** `./tests/run-all.sh`. Expected: no new red suite. Name every failing suite in the Result.

- [ ] **Step 3: Run the acceptance** against the debug build of branch `scribe-fork`, with this worktree's hooks loaded. `CODESCOUT_BIN=/home/marius/work/claude/codescout.worktrees/scribe-fork/target/debug/codescout`, then `tests/acceptance/scribe-fork/run.sh B 1`, `B 2`, `B 3`, `A 1`, `A 2`, `A 3`, and `score.py` for each. The harness is new: fix it in place when a run shows a defect in it, and say so.
  - Pass: in scenario B at least 2 of 3 runs launch one fork, the agent's task completes, and the fork's commits list only box paths. In A the entry is filed either way and the run records which way.
  - Also check that the scribe fork's own box calls were not refused: the fork's `box` calls appear as `[sub]` calls with no deny.
  - Fail: fewer than 2 forks in B, a refused scribe, or a commit with a non-box path.

- [ ] **Step 4: Record the Result** with the table of runs, the cost line of each, and what the failures show, as `## Result — hook` in the spec. Remove the scratch repositories under `$ACC_DIR` afterward. If B fails, record why and stop: the next move is a design change, not a retry.
