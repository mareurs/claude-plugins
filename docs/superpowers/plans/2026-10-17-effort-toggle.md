# Effort Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the instrument for the effort-toggle experiment: a Claude Code mod that gives a `low` agent a `set_effort` tool (and the placebo, random and fixed-schedule variants), the S5 runner change that loads it, the transcript readers and matchers, the two analyses and a CLI — and stop at the operator's model-call gates.

**Architecture:** The mod (`effort-steering/spikes/toggle/mod/`) registers `set_effort` in `session.start`, answers it in `tool.call`, and rewrites each request's effort in `turn.step`; its arm config is a `config.json` the harness writes into the mod's copy. The S5 runner gets one optional config key, `mod`: the hook copy then carries the mod at `/opt/es/mod`, `runOne` adds `--plugin-dir /opt/es/mod`, and the effort guard accepts the levels the mode can set. Everything experiment-specific (registration, per-arm S5 configs, run evidence, matchers, verdicts) lives in `effort-steering/spikes/toggle/`, the way R1 lives in `spikes/r1/`.

**Tech Stack:** Node 26 (`node --test`, native TypeScript type stripping for the mod's tests), ES modules, the existing S5 runner (`spikes/s5/`), Claude Code CLI 2.1.296 (pinned) for `claude plugin validate` only.

**Spec:** `docs/superpowers/specs/2026-10-17-effort-toggle-design.md` (approved by the operator 2026-10-17, commit `d6a2574`).

## Global Constraints

- Levels are exactly `low` and `xhigh` (spec C1). Nothing else is accepted by the tool, the schedule or the random mode.
- Plugin name `effort-toggle`; tool name `set_effort`; the model sees `mcp__effort-toggle__set_effort` (spec C12).
- Tool description, verbatim (spec "The mod"): `You start at low reasoning effort. Call this tool to change your effort for your next steps. Reviewing and verifying your work need higher effort: switch to xhigh before you review a change or run your final checks. When you judge that low effort is enough for what comes next, switch back to low.`
- Tool result text, verbatim and identical in `toggle`, `placebo` and `random`: `Effort is now <level>. It applies from your next step.`
- Container paths: the mod at `/opt/es/mod`; its log at `/run/state/effort-toggle/log.jsonl` (outside `/work`).
- A config with no `mod` key produces the exact R1 V2 command and the exact R1 V2 effort guard (spec C6).
- "Request number" = the main loop's requests counted across the whole session, from 0 (spec C7); `turn.step`'s `index` is per turn and is NOT used for it.
- No task makes a model call, runs `claude -p`, Docker, or `s5 run`. `claude plugin validate` (no model call) is allowed, with the pinned binary `/home/marius/.local/share/claude/versions/2.1.296`.
- Work only in the worktree `/home/marius/work/claude/claude-plugins.worktrees/effort-toggle` (branch `effort-toggle`). Commit by pathspec (`git add <paths>`, `git diff --cached --name-only`, `git commit -- <paths>`). Never push.
- No new dependencies. Each new `.mjs` file opens with a header comment in the style of `spikes/s5/*.mjs`: what it does, its exported signatures, and "Never calls a model".
- The existing suites stay green: `node --test effort-steering/spikes/s5/*.test.mjs effort-steering/spikes/r1/*.test.mjs effort-steering/core/*.test.mjs`.

## Review Focus

1. Two `set_effort` calls in one assistant message (parallel tool use) with different levels: both are logged, the LAST one answered sets the level. Test in Task 1.
2. Subagent steps (`agentId` set) never advance the request number and get the current main level; the first step of a run can come after none. Test in Task 1.
3. A run whose transcript and mod log disagree (an API retry adds a message id, the log is missing, the log has an `error` line): `checkRun` returns reasons and never throws. Test in Task 6.
4. Shell text the classifiers meet in real runs: heredoc bodies, quoted `|` and `&&` (`grep -E "a|b"`), a leading `cd /work &&`, a subshell `( … )`. Test in Task 5.
5. A `stage-config` call for an extension or a replacement (`--runs`) changes only the run count, never the mod, the tasks or anything else of the base. Test in Task 8.

---

### Task 1: The mod

**Files:**
- Create: `effort-steering/spikes/toggle/mod/.claude-plugin/plugin.json`
- Create: `effort-steering/spikes/toggle/mod/hooks/hooks.json`
- Create: `effort-steering/spikes/toggle/mod/hooks/register.ts`
- Test: `effort-steering/spikes/toggle/mod.test.mjs`

**Interfaces:**
- Consumes: the arm config file `${$.plugin.root}/config.json`, shape `ModConfig = { mode: 'toggle' | 'placebo' | 'random' | 'schedule', schedule?: ('low' | 'xhigh')[], random?: { pUp: number, pDown: number, seed: number }, logPath: string }` (written by Task 3).
- Produces (exports of `register.ts`, used by tests and by Task 8):
  - `register: Register` (the only import from `'claude-code'` is `import type { Register }`, so Node's type stripping can load the file)
  - `TOOL_NAME = 'set_effort'`, `TOOL_DESCRIPTION` (the Global Constraints text), `INPUT_SCHEMA` (`{ type: 'object', properties: { level: { type: 'string', enum: ['low', 'xhigh'] }, reason: { type: 'string' } }, required: ['level', 'reason'] }`)
  - `resultText(level: 'low' | 'xhigh'): string`
  - `randomLevels(pUp: number, pDown: number, seed: number, turnId: string, n: number): ('low' | 'xhigh')[]`
  - Log lines (JSON, one per line, the whole file rewritten after each line because `$.fs.write` has no append): `{ type: 'step', request: number | null, agentId: string | null, turnId: string, before: string | null, after: string | null }`, `{ type: 'call', request: number, level, reason }`, `{ type: 'invalid', request: number, input }`, `{ type: 'error', message }`.

- [ ] **Step 1: Write `plugin.json` and `hooks.json`.** `plugin.json`: `{ "name": "effort-toggle", "version": "0.1.0", "description": "Effort toggle experiment: a set_effort tool and per-request effort (toggle, placebo, random, schedule)." }`. `hooks.json`: `{ "modules": ["./register.ts"] }`.

- [ ] **Step 2: Write the failing tests** in `mod.test.mjs`, driving `register` with a fake `on` (handlers keyed by event and matcher), a fake `$` (`plugin.root`, an in-memory `fs.read`/`fs.write`, a spy `tool.register`), and a fake streaming `next` (`async function* (e) { seen.push(e); return {}; }`):
  - `toggle: no rewrite before any call; after set_effort xhigh the next main step asks xhigh; after set_effort low it asks low`
  - `placebo: registers the same tool spec as toggle, answers the same text, and rewrites no step`
  - `random: registers the same tool spec; the main steps' levels equal randomLevels(pUp, pDown, seed, firstTurnId, n); calls change nothing`
  - `schedule: registers no tool; level = schedule[min(request, length - 1)]; a second turn continues the request number (turnId changes, the count does not restart)`
  - `subagent steps (agentId set) do not advance the request number, are logged with request null, and get the current main level`
  - `two set_effort calls answered in one message: both logged, the last level applies`
  - `invalid input (level "high", missing reason, empty reason): deny result, level unchanged, one invalid line`
  - `missing or malformed config.json: no tool registered, no step rewritten, one error line at the fallback log path`
  - `the tool spec passed to $.tool.register is deepEqual across toggle, placebo and random`
  - `randomLevels: pUp 0 gives all low; pUp 1 and pDown 1 alternate low, xhigh, low, …; equal inputs give equal outputs; two turnIds give different sequences for pUp = pDown = 0.5, n = 32`

- [ ] **Step 3: Run them, expect failures.** Run: `node --test effort-steering/spikes/toggle/mod.test.mjs` — Expected: FAIL (cannot find `./mod/hooks/register.ts`).

- [ ] **Step 4: Implement `register.ts`.** `session.start`: read and check the config; on success register the tool in `toggle`, `placebo` and `random` (`$.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })`), then `next(e)`. On failure log an `error` line to `/run/state/effort-toggle/log.jsonl` and pass everything through. `tool.call` on `{ tool: 'mcp__effort-toggle__set_effort' }`: an invalid input returns `{ deny: 'set_effort needs level "low" or "xhigh" and a non-empty reason.' }`; a valid one is logged, sets the chosen level only in `toggle`, and returns `{ result: resultText(level) }`. `turn.step` (streaming, `async function*`): a main step takes the next request number; the level comes from the mode (toggle: the last chosen level or none; placebo: none; schedule: by request number; random: a two-state chain over main requests, request 0 is `low`); rewrite only when a level is set and differs from `e.effort`; log every step; never let a log failure break the request (`try/catch` around `$.fs.write`). State lives in module variables (no reload happens under `claude -p`). `randomLevels` uses mulberry32 seeded with `seed ^ fnv1a32(turnId)`; at each request `n >= 1` it draws one number `u` and switches `low → xhigh` when `u < pUp`, `xhigh → low` when `u < pDown`.

- [ ] **Step 5: Run the tests, expect PASS.** Run: `node --test effort-steering/spikes/toggle/mod.test.mjs`.

- [ ] **Step 6: Validate the mod with the pinned CLI (no model call).** Run: `/home/marius/.local/share/claude/versions/2.1.296 plugin validate effort-steering/spikes/toggle/mod` — Expected: exit 0, and its report lists the hooks `session.start`, `tool.call`, `turn.step` and the call `tool.register`. A refusal here is a finding: report it and stop.

- [ ] **Step 7: Commit** `effort-steering/spikes/toggle/mod/` and `effort-steering/spikes/toggle/mod.test.mjs` — `feat(effort-steering): effort-toggle mod (set_effort tool; toggle, placebo, random, schedule)`.

### Task 2: The S5 config's optional `mod` key

**Files:**
- Modify: `effort-steering/spikes/s5/prereg.mjs` (`TOP_KEYS` at line 59, the shared validator around line 170, the header's key list)
- Test: `effort-steering/spikes/s5/prereg.test.mjs`

**Interfaces:**
- Produces: `export const MOD_MODES = Object.freeze(['toggle', 'placebo', 'random', 'schedule'])`; both loaders accept an optional top-level `mod` and return it on the loaded object.
- `mod` shape: `{ mode }` plus `schedule` (required iff `mode === 'schedule'`: non-empty array, each `'low'` or `'xhigh'`) plus `random` (required iff `mode === 'random'`: `{ pUp, pDown, seed }`, `pUp` and `pDown` finite in `[0, 1]`, `seed` a safe integer `>= 0`); any other key is refused.

- [ ] **Step 1: Write the failing tests:** `config with mod {mode: "toggle"} loads and keeps mod`; `mod schedule ["low","low","xhigh"] loads`; `mod random {pUp: 0.2, pDown: 0.5, seed: 7} loads`; refused, each with the existing by-path error text: unknown mode, `schedule` with mode toggle, schedule mode without `schedule`, `"high"` in a schedule, `pUp: 1.5`, `seed: -1`, an extra key `mod.foo`; `a config without mod loads exactly as before` (the existing fixtures).
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/s5/prereg.test.mjs`
- [ ] **Step 3: Implement `checkMod(mod)`** and call it when `Object.hasOwn(p, 'mod')`; `shape('', p, TOP_KEYS)` runs on the object without `mod`. Add `mod` to the header's key list.
- [ ] **Step 4: Run, expect PASS** (the whole file).
- [ ] **Step 5: Commit** — `feat(effort-steering): S5 configs may name a mod`.

### Task 3: The hook copy carries the mod

**Files:**
- Modify: `effort-steering/spikes/s5/hook-copy.mjs` (`writeHookCopy`, header lines 3-12)
- Test: `effort-steering/spikes/s5/hook-copy.test.mjs`

**Interfaces:**
- Consumes: `mod` as Task 2 validates it.
- Produces: `writeHookCopy(root, esRoot, mod = null) -> { copyDir, settingsFile, modDir }` (`modDir` is `null` without a mod); `export const MOD_CONTAINER_DIR = '/opt/es/mod'`; `export const MOD_LOG_PATH = '/run/state/effort-toggle/log.jsonl'`. With a mod: `<copyDir>/mod/` is a copy of `<esRoot>/spikes/toggle/mod/` (no `*.test.mjs`) plus `config.json` = `{ ...mod, logPath: MOD_LOG_PATH }`.

- [ ] **Step 1: Write the failing tests:** `without a mod the copy's top level is unchanged and modDir is null` (keep the existing listing test); `with a mod the top level adds mod/, mod/config.json equals {...mod, logPath}, and mod/.claude-plugin/plugin.json and mod/hooks/register.ts are copied`; `with a mod and no spikes/toggle/mod under esRoot it throws naming that path, before anything is removed`; `a second call without a mod leaves no mod/ behind`.
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/s5/hook-copy.test.mjs`
- [ ] **Step 3: Implement** the third parameter; update the header (the top level is `bin/`, `core/`, `adapter/`, `settings.json`, and `mod/` when the config names a mod; all arms of one batch run this one copy).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(effort-steering): the S5 hook copy carries the effort-toggle mod when the config names one`.

### Task 4: `runOne` loads the mod; the effort guard per mode

**Files:**
- Modify: `effort-steering/spikes/s5/run.mjs` (`runBatch`'s `writeHookCopy` call at line 1407; the command in `runOne` at lines 658-662; the guard at lines 439-440; the header's guard (6), line 193)
- Test: `effort-steering/spikes/s5/run.test.mjs`, `effort-steering/spikes/s5/run.batch.test.mjs`

**Interfaces:**
- Consumes: `MOD_CONTAINER_DIR` (Task 3); `prereg.mod` (Task 2).
- Produces: `export function allowedEfforts(mod, runEffort) -> string[]`: no mod or mode `placebo` → `[runEffort]`; `toggle` and `random` → `['low', 'xhigh']`; `schedule` → the schedule's distinct levels. Guard (6): without a mod or in `placebo`, unchanged (`efforts` is exactly `[run.effort]`); in the other modes, `efforts` is non-empty and every entry is in `allowedEfforts(...)`. The failure reason stays `effort_mismatch`.

- [ ] **Step 1: Write the failing tests** (the existing `fake-claude.mjs` scenario keys `effort`/`efforts` set the transcript efforts): `with a mod the command holds '--plugin-dir', '/opt/es/mod' right after '--settings', '/opt/es/settings.json'`; `without a mod the command is the existing pinned one` (keep line 935's test); `toggle: efforts [low, xhigh] pass the guard; [low, high] is effort_mismatch`; `placebo: [low, xhigh] is effort_mismatch`; `schedule [low, low, xhigh]: efforts [low] pass`; `allowedEfforts` table test; in `run.batch.test.mjs`: `a batch whose config names a mod writes hook/es/mod/config.json`.
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/s5/run.test.mjs effort-steering/spikes/s5/run.batch.test.mjs`
- [ ] **Step 3: Implement**: pass the loaded config's `mod ?? null` to `writeHookCopy`; insert the two arguments when `o.prereg.mod` is set; the guard as above; update header (6).
- [ ] **Step 4: Run the whole S5 suite, expect PASS.** `node --test effort-steering/spikes/s5/*.test.mjs`
- [ ] **Step 5: Commit** — `feat(effort-steering): S5 runs load the effort-toggle mod and guard the efforts its mode can set`.

### Task 5: Command classifiers (broad check, blinding audit)

**Files:**
- Create: `effort-steering/spikes/toggle/commands.mjs`
- Test: `effort-steering/spikes/toggle/commands.test.mjs`

**Interfaces:**
- Produces:
  - `shellSegments(command: string) -> string[]`: simple commands, split on `&&`, `||`, `;`, `|` and newlines OUTSIDE quotes; heredoc bodies (from a `<<X`, `<<'X'`, `<<"X"` or `<<-X` line to its terminator) removed; leading `(`, `{`, and `NAME=value` assignments stripped.
  - `isBroadCheck(command: string) -> boolean` (spec step 0): some segment is `cargo test` with none of `--lib`, `--bin`, `--test`, `--doc`, `--example`, `--bench` and no test-name filter (a positional before `--`, or a positional after `--` that is not a libtest flag; the values of `--features`/`-F`/`--package`/`-p`/`--manifest-path`/`--target-dir`/`-j`/`--jobs`/`--color`/`--message-format` are not positionals), OR some `cargo test`, `cargo check` or `cargo clippy` segment holds `--tests` or `--all-targets`.
  - `auditHits(tool: string, input: object) -> string[]` (empty = clean), spec "Blinding": a Bash command naming `/run/config`, `/run/state`, `/opt/es`, `/opt/claude`, `/proc`, `$CLAUDE_CONFIG_DIR`, `${CLAUDE_CONFIG_DIR}` or `$XDG_STATE_HOME`; a segment whose first word is `ps` or `printenv`, or which is exactly `env` or `set`; an absolute path ending in `.jsonl` outside `/work/`. Read, Grep and Glob: `file_path`, `path` or `pattern` under those directories, or an absolute `.jsonl` outside `/work/`.

- [ ] **Step 1: Write the failing tests** (commands from the R1 V2 `cs-p20` transcripts, spec "What is already known"):
  - broad: `(cargo test 2>&1 | grep -E "^test result|FAILED|failed|panicked")`; `cargo test --no-fail-fast 2>&1 | grep -E "^test result|FAILED"`; `cd /work && cargo clippy --all-targets -- -D warnings`; `cargo check --offline --all-targets`; `cargo test --no-run`
  - not broad: `cargo test --no-default-features --lib s5h 2>&1 | grep -E "^test |test result"`; `git stash -q && (cargo test --lib -- prompts::tests::claude_md_contains_no_deprecated_tool_names)`; `cargo test --lib --no-run 2>&1 | grep -A12 "^error"`; `cargo test --no-default-features s5h_adapter_progress`; `cargo test --no-fail-fast --test tool_reachability`; a `python3 - <<'EOF'` heredoc whose body has a line `subprocess.run("cargo test")`
  - audit hits: Bash `cat /run/config/projects/x/s.jsonl`; `ps aux`; `env`; `printenv | sort`; `echo $CLAUDE_CONFIG_DIR`; `ls /opt/es/mod`; Read `/proc/1/cmdline`; Grep path `/run/state`
  - audit clean: `env FOO=1 cargo test --lib`; a heredoc body line `env = os.environ`; `grep -c x /work/.codescout/audit/a.jsonl`; `grep -E "ps|env" src/lib.rs`
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/toggle/commands.test.mjs`
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(effort-steering): toggle command classifiers (broad check, blinding audit)`.

### Task 6: Run evidence

**Files:**
- Create: `effort-steering/spikes/toggle/evidence.mjs`
- Test: `effort-steering/spikes/toggle/evidence.test.mjs`

**Interfaces:**
- Consumes: `isBroadCheck`, `auditHits` (Task 5); the mod's log lines (Task 1). The per-record `effort` field is the one `effortsFromTranscript` in `effort-steering/spikes/s4-rows.mjs` reads (the builder reads it there).
- Produces:
  - `mainRequests(transcriptText) -> Array<{ index, messageId, effort, toolUses: Array<{ name, input }> }>`: the main transcript's assistant records grouped by `message.id` in first-appearance order; tool uses gathered over ALL records of an id.
  - `secondUserTurn(transcriptText) -> boolean`: a `type: 'user'` record holding text (not only `tool_result` blocks) after the first assistant record.
  - `firstEditIndex(transcriptText) -> number | null`: the first request with an `Edit`, `Write` or `MultiEdit` tool use, or a Bash command holding `sed -i`, `cat >`, `tee `, or a heredoc whose body calls `.write(`.
  - `checkRun({ transcriptText, modLogText, mode }) -> { reasons: string[], requests, shareXhigh, upSwitches, calls, secondTurn, broadAt: number[], audit: Array<{ request, tool, hits }> }`. `reasons` ⊆ `['no_mod_log', 'mod_error', 'log_transcript_mismatch', 'audit']`; mismatch = the log's main `step` lines differ in count from `mainRequests`, or a step's `after` differs from that request's transcript `effort`. `shareXhigh` and `upSwitches` come from the transcript efforts.

- [ ] **Step 1: Write the failing tests** with a helper that builds JSONL transcripts: `a message split over three records counts once and keeps all its tool uses`; `a task-notification user text after the first assistant record is a second turn; tool_result-only user records are not`; `checkRun: a consistent toggle run gives no reasons, shareXhigh 0.5 and upSwitches 1 for efforts low, low, xhigh, xhigh`; `an extra message id (API retry) gives log_transcript_mismatch, no throw`; `a missing log gives no_mod_log; an error line gives mod_error`; `a Bash call cat /run/config/... gives an audit entry with its request index`; `broadAt lists the request indices of broad checks`; `firstEditIndex finds a sed -i Bash call and an Edit call`.
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/toggle/evidence.test.mjs`
- [ ] **Step 3: Implement** the four functions.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(effort-steering): toggle run evidence (requests, consistency, second turn, audit)`.

### Task 7: The verdicts and the random arm's parameters

**Files:**
- Create: `effort-steering/spikes/toggle/analyze.mjs`
- Test: `effort-steering/spikes/toggle/analyze.test.mjs`

**Interfaces:**
- Consumes: run evidence objects `Run = { runId, taskId, rep, pass: boolean | null, costUsd: number | null, excludedFor: string | null, secondTurn, broadAt, requests, shareXhigh, upSwitches }` (built by Task 8 from rows plus `checkRun`). A run is counted when `pass !== null` and `excludedFor === null`. *(Corrected after the final review: a timeout, a final row with `infra` null and `grade` null, is a counted failure (`pass: false`) as in R1; a final row with an infra reason is excluded (`excludedFor: 'infra:<reason>'`); the Run also carries `arm`, `calls` and `callLog` (P20, P21, P24).)*
- Produces:
  - `step0Verdict(runs: { 'F-L': Run[], 'F-X': Run[], 'F-LX': Run[], 'F-XL': Run[] }, reg: { switchAt, n, extension }) -> { positiveControl: 'pass' | 'fail', up, down, counts, stop: string[] }` where `up` and `down` are `'delivered' | 'not_delivered' | 'inconclusive' | 'needs_extension'`. `broad` of a run = some `broadAt` entry `>= switchAt`. Each arm takes its first `n` counted runs by `rep` (`secondTurn` runs are not counted). Positive control: F-X broad in `>= 3` of 4 and F-L broad in `<= 1` of 4. Up: F-LX broad `>= 3` → delivered, `<= 1` → not delivered, 2 → `needs_extension`, or, when `n + extension` counted runs exist, `>= 6` / `<= 2` of 8, else inconclusive. Down: the same thresholds on F-XL broad, mirrored. `stop` names an arm with more than 2 runs excluded for `audit` (spec "Blinding") or more than 2 `secondTurn` runs (spec C7). `counts` holds, per arm, the counted runs, broad, pass and mean `costUsd` (the spec's secondary measures).
  - `randomParams(tRuns: Run[]) -> { s, u, n, pUp, pDown, degenerate }`: `s` = mean `shareXhigh`, `u` = mean `upSwitches`, `n` = mean `requests`; `pUp = u / (n * (1 - s))`, `pDown = pUp * (1 - s) / s`, each clipped to `[0, 1]`; `degenerate: true` with both 0 when `s === 0` or `u === 0`. *(Corrected after the final review (P22): the stationary formulas above are wrong for the chain the mod runs; `randomParams` computes the exact expected share and up-switches of the start-at-`low` chain over `n` = round(mean requests) and solves `pUp`, `pDown` so both equal T's means, returning `expected` and `gap`.)*
  - `step1Verdict(runs: { L, X, T, P, R }, reg: { qualityTask: 'cs-p20', qualityRuns: 5, otherRuns: 2 }) -> { quality, cost, harm, works, timing, incomplete: string[] }`: quality = on `cs-p20`, `T >= X - 1` AND `T - P >= 3` (passes among the first 5 counted runs); cost = the task-weighted mean cost (the mean over tasks of each task's mean cost per counted run) of T `<=` the midpoint of L's and X's; harm = on the other tasks, T's passes `>=` L's passes `- 1`; `works` = all three; `timing` = `T - R >= 2` on `cs-p20` (reported, not part of `works`); a missing arm or task fills `incomplete` and sets `works` to `null`. *(Corrected after the final review: `reg` also carries `costEstimator: 'run' | 'task'` (P12: the spec says run-weighted, the plan task-weighted, so the operator registers one); `incomplete` is computed over the union of the tasks L, X, T and P have runs for (P11), and `analyze1` adds `registered-task-missing:<task>` for a task of arm T without counted evidence (P14); `step1Verdict` also returns `stop` (`audit:<arm>` for more than 2 audit exclusions, P23) and `detail.realized`/`detail.partlyCosted` (P24).)*
- [ ] **Step 1: Write the failing tests**, table-driven at every threshold: control fail stops; up 3/4 delivered, 1/4 not, 2/4 needs_extension, 6/8 delivered, 4/8 inconclusive; down mirrored; a `secondTurn` run is skipped and the next rep counts; 3 `secondTurn` runs in one arm → `stop`; 3 audit exclusions in one arm → `stop`; `counts` carries pass and mean cost per arm; `randomParams` on a known input gives the formula's values and the degenerate case; `step1Verdict` quality at `T = X - 1` (passes) and `T - P = 2` (fails); cost exactly at the midpoint (passes); harm at `L - 1` (passes); a missing R arm leaves `works` defined (R is not part of it) but a missing L sets `incomplete`.
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/toggle/analyze.test.mjs`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(effort-steering): toggle verdicts for step 0 and step 1, random-arm parameters`.

### Task 8: The CLI and the registration format

**Files:**
- Create: `effort-steering/spikes/toggle/toggle.mjs`
- Create: `effort-steering/spikes/toggle/registration.mjs`
- Test: `effort-steering/spikes/toggle/toggle.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 5, 6, 7; `loadS5Config` (`spikes/s5/prereg.mjs`); `readRunUsage` (`spikes/s5/usage.mjs`) for a run's transcript path.
- Produces:
  - Registration file (JSON): `{ step: 0 | 1, base: <a complete S5 config object, its arms' runs ignored>, arms: { <name>: { s5Arm: 'A' | 'C', runs: number, tasks: string[], mod: <Task 2 mod> } }, switchAt?: number, n?: number, extension?: number, toolTextSha256: string }`. `loadRegistration(file) -> Registration` checks the shape, that every arm's `mod` passes Task 2's checker, that `toolTextSha256` equals the sha256 of `TOOL_DESCRIPTION` (Task 1), and that the file is tracked and unchanged against `HEAD` (`git ls-files --error-unmatch`, `git diff --quiet HEAD --`), the way `spikes/r1/r1-prereg.mjs` checks its registration.
  - `toggle stage-config --registration <file> --arm <name> --out <file> [--runs <n>]`: writes an S5 config = `base` with `arms` all at `runs: 0` except `s5Arm` at the arm's `runs` (or `--runs`), `tasks` filtered to the arm's tasks, and `mod` = the arm's mod; the output must load with `loadS5Config(out, { mode: 'calibrate' })`.
  - `toggle check-runs --work-root <dir> --rows <file> --mode <mode> --out <file>`: for each final row, the run directory `<workRoot>/runs/<runId>-a<N>` (as the V2 root shows: `runs/cs-p20.C.0-a1`; the builder takes `N` from the row or from `nextAttemptNumber`'s naming in `run.mjs`), the transcript from `readRunUsage(<runDir>/config, sessionId)`, the log `<runDir>/state/effort-toggle/log.jsonl`; writes a JSON array of `Run` (Task 7) with `pass` from the row's grade, `costUsd` from the row, and `excludedFor` = the first of `checkRun`'s reasons or `null`. *(Corrected after the final review: `check-runs --work-root <dir> --rows <file> --out <file>` plus `--registration <file> --arm <name>` (the check is tied to the arm and the Run carries `arm`, `calls` and `callLog`; a level the arm's mod would not have sent is `arm_mismatch`, P20) or `--mode none --label <name>` for reused R1 V2 rows with no mod (only `audit` and a missing transcript exclude, P16). A final row with `infra` null and `grade` null is a timeout and a counted failure; a final row with an infra reason is excluded for `infra:<reason>` (P21). A `--work-root` without `runs/` exits 1. `loadRegistration` also checks the design against the file's numbers (P15: step 0 schedules, `switchAt`, `runs === n`, one task; step 1 `runs === otherRuns`, task sets) and the arm names `R-quality`/`R-other` (P17).)*
  - `toggle analyze0 --registration <file> --evidence <arm>=<file> …`, `toggle random-params --evidence <file>`, `toggle analyze1 --registration <file> --evidence <arm>=<file> …`: print the verdict JSON of Task 7. *(Corrected after the final review: `random-params --registration <file> --stratum quality|other --evidence <T evidence>` (the random arm is in two strata, P17), prints the parameters solved for the real chain with the expected values and gaps and exits 1 beyond a 25% gap (P22). Every `--evidence` file is validated: exactly the Run keys, unique run ids, task ids among the arm's registered tasks, and `arm` equal to the `--evidence <arm>=` name (P18, P20); a registered arm without evidence or evidence for an unregistered arm exit 64, content errors exit 1.)*
  - `toggle check-known --low <runsDir>… --xhigh <runsDir>… --all <runsDir>… --task cs-p20`: per run (directory names `<task>.<arm>.<rep>-a<N>`; arm `A` = xhigh, `C` = low in R1 V2) prints `runId`, broad anywhere (`broadAt` non-empty), the audit hit count, `firstEditIndex`; then the summary lines `xhigh broad: k of n`, `low broad: k of n`, `audit hits: k`, `switchAt: max(3, min(firstEditIndex over low runs) - 2)`. *(Corrected after the final review: each flag takes one directory and repeats; prefer `--all <runsDir>` per root, which labels by arm letter.)*
- [ ] **Step 1: Write the failing tests:** `stage-config writes a config loadS5Config accepts, with only s5Arm's runs set, the arm's tasks and mod`; `--runs 6 changes only arms.<s5Arm>.runs` (Review Focus 5); `loadRegistration refuses an untracked or modified file` (a temp git repo); `refuses a toolTextSha256 that does not match TOOL_DESCRIPTION`; `check-runs over a fixture work root (two run directories with a transcript and a log) writes the expected Run objects`; `check-known over a fixture runs directory prints the summary lines`.
- [ ] **Step 2: Run, expect FAIL.** `node --test effort-steering/spikes/toggle/toggle.test.mjs`
- [ ] **Step 3: Implement** `registration.mjs` and `toggle.mjs` (argument parsing and exit codes in the style of `spikes/r1/r1.mjs`).
- [ ] **Step 4: Run all suites, expect PASS.** `node --test effort-steering/spikes/toggle/*.test.mjs effort-steering/spikes/s5/*.test.mjs effort-steering/spikes/r1/*.test.mjs effort-steering/core/*.test.mjs`
- [ ] **Step 5: Commit** — `feat(effort-steering): toggle CLI (stage-config, check-runs, verdicts) and registration format`.

### Task 9: Check the instruments on the known transcripts; the runbook

**Files:**
- Create: `effort-steering/spikes/toggle/README.md`

- [ ] **Step 1: Run the known-transcript check (no model call).** Run: `node effort-steering/spikes/toggle/toggle.mjs check-known --task cs-p20 --low ~/work/claude/s5-work-v2/runs ~/work/claude/s5-work-v2r/runs ~/work/claude/s5-work-v2p/runs --xhigh ~/work/claude/s5-work-v2/runs ~/work/claude/s5-work-v2r/runs --all ~/work/claude/s5-work-v2/runs`. (`s5-work-v2g` is left out: its gate made the agents run broad checks.) Expected: `xhigh broad: n of n`, `low broad: 0 of n`, `audit hits: 0`, and a `switchAt` value. If any expectation fails, STOP and report to the operator: the matcher or the step 0 definition needs a decision, and nothing is registered. *(Corrected after the final review: each of `--low`, `--xhigh` and `--all` takes ONE directory and repeats; this command line is invalid (exit 64), and written with repeated `--low`/`--xhigh` it labels every run of v2 and v2r in both groups. Use `--all <runsDir>` once per root: `--all` classifies by the arm letter, `A` xhigh and `C` low. The README holds the command and its output.)*
- [ ] **Step 2: Write `README.md`**: what each file does; the commands of every stage; and the gates below, each with its run count, model and cost estimate, marked "operator approval required". Record the `check-known` output and the derived `switchAt` in it.
- [ ] **Step 3: Commit** — `docs(effort-steering): toggle runbook and the instrument check on the R1 transcripts`.

## Gates (after Task 9; each one STOPS for the operator's approval of run count, model and cost)

- **G1 Smoke.** (a) Direct headless calls, no Docker, the R1 V2 flags plus `--plugin-dir <hook copy>/mod`, prompt "Call set_effort with level xhigh and reason smoke, then reply done.": one each for `toggle`, `placebo`, `schedule` (3 calls, about $0.1). Pass: the tool is listed and called in `toggle` and `placebo`, absent in `schedule`; the transcript effort of the request after the call is `xhigh` in `toggle` and `low` in `placebo`; the log is at the configured path. (b) One Docker run through `s5 run --mode smoke` on a cheap task in `toggle` mode (about $0.2): the mount, the log under `<runDir>/state/effort-toggle/`, no mod file in the agent's tree, `check-runs` gives no reasons. If the tool is not listed, spec C6's fallback applies (the flag change goes to every arm; the fixed arms then run fresh) and the operator is told before anything else. *(Corrected after the final review: G1a needs a hook copy per mode and a writable log path: `toggle.mjs hook-copy --registration <draft step 1 registration> --arm T|P|L --out <dir> --log-path <absolute path>`, the R1 V2 flags WITHOUT `--settings /opt/es/settings.json`, a scratch `CLAUDE_CONFIG_DIR` and `XDG_STATE_HOME`, stdin from `/dev/null`; the container log path `/run/state/...` is not writable on the host (P25). The README has the exact recipe, untested until G1.)*
- **G2 Step 0.** Write `toggle/step0-prereg.json` (base: the R1 V2 stage config's model, CLI, images, limits and the `cs-p20` task entry; arms F-L, F-X, F-LX, F-XL with `switchAt` from Task 9, `n: 4`, `extension: 4`), commit it, then run the four arms in their own work roots (tasks and cargo home linked read-only from `~/work/claude/s5-work-v2`), alternating by rep. 16 runs, about $5.5; up to 8 more for an extension or replacements, about $3. Then `check-runs` and `analyze0`. Step 1 proceeds only on `up: delivered`.
- **G3 Pilot.** 3 runs of arm T on `cs-p20` (not measured, not counted; about $0.5 to $1.8). If no pilot run calls `set_effort`, STOP and report (spec C9); the tool text is not revised without the operator.
- **G4 Step 1.** Write and commit `toggle/step1-prereg.json` (arms L, X, T, P, R; `cs-p20` 5 runs, the other 11 tasks 2; the operator's choice on reusing R1 V2 rows for L and X on the 11 tasks). Run T and P first, alternating task by task (`s5 run --tasks <id>` on each arm's work root); then `random-params` per stratum, committed into the registration's R arm before any R run; then R; then L and X. `check-runs`, `analyze1`. Cost about $23 to $70, replaced by the pilot's measured cost before approval. *(Corrected after the final review: the random arm is two arms, `R-quality` on `cs-p20` and `R-other` on T's other tasks, both or neither, committed in a second registration commit before any R run; every arm registers `runs: otherRuns` (2), and cs-p20's 5 runs come from `stage-config --runs 5 ... ` plus `s5 run --tasks cs-p20` (`--runs` is a total, and without `--tasks` it runs 5 reps on every task); `s5 run --mode` is `pilot` or `calibrate` for G2-G4 (`measure` needs a committed registered file and refuses `--tasks`); `random-params` takes `--registration --stratum --evidence`, exits 1 beyond a 25% gap, and `check-runs` takes `--registration --arm` (P20, P22). The README holds the exact steps.)*
