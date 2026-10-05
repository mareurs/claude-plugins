# Effort Steering Second Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Claude Code adapter for the `effort-steering` core, measure whether steering text moves thinking depth, and package the result as a plugin only if it does.

**Architecture:** The adapter is a `UserPromptSubmit` hook in `effort-steering/adapter/claude-code/`. It builds a neutral context, calls the existing `bin/effort-policy.mjs decide` as a child process with a wall-clock timeout, and emits `additionalContext` only when `steer` is not null. The hook always exits 0. The experiment (S4, S5) runs through a scratch settings file, as spike S1 did, so no manifest exists until the gate passes.

**Tech Stack:** Node ESM run with `node --experimental-strip-types`; tests use `t` from `effort-steering/core/testkit.mjs` and are found by `tests/run-all.sh`; bash for the release.

**Spec:** `/home/marius/work/claude/codescout/docs/superpowers/specs/2026-10-04-effort-steering-design.md` (decisions D1, D2, D5; sections "Measurement and gates", "Unverified claims register", "Constraints carried into the second plan"). Also read: `docs/research/2026-10-04-effort-steering-spike-findings.md` and `docs/research/2026-10-04-effort-steering-branch-review-notes.md` in the same repo. The work list is the tracker `docs/trackers/effort-steering-second-phase.md` (id `af4ccc8b94a95c91`, entries ES-N). ES-1, ES-7 and ES-8 are done.

## Global Constraints

- The CLI exit code 64 (usage error) and the reason names `unknown_arg`, `bad_holdout_rate`, `rules_unreadable`, `table_unreadable`, `log_failed`, `rules_skipped:<id>:<error>` must not change.
- The hook must always exit 0. Exit code 2 from a `UserPromptSubmit` hook blocks and erases the user's prompt.
- `turn_id`, `harness` and `session_id` come from the hook input fields only, never from prompt text.
- No `llm-proxy`, no `ANTHROPIC_BASE_URL` rewriting, no classifier, no settings-file writer.
- No `plugin.json`, no `marketplace.json` entry and no README version-table row before Task 10. Never bump a version outside `./scripts/release.sh`.
- No model-call run (S4, S5) without the operator's approval and a committed preregistration (Task 5).
- Logs and stderr never carry prompt text.
- Plugin code resolves config paths with `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, never bare `$HOME/.claude`.
- Every task ends with `./tests/run-all.sh` passing, and a commit. Nothing is pushed by this plan.

## Review Focus

1. A 200 KB prompt (a pasted log) reaches the hook: it must finish inside the timeout and exit 0 (Task 4).
2. The state directory is unwritable: the steering text is still delivered, `log_failed` reaches stderr, exit 0 (Task 4).
3. `prompt_id` is missing or not a string: the decision is still made, nothing is invented for `turn_id`, `log_skipped_no_ids` shows (Tasks 2 and 4).
4. Stdout hygiene: with no steering the hook prints nothing; with steering it prints exactly one JSON line (Task 4).
5. The CLI is killed at the timeout: the hook returns `default` with no steering and no half-written log line (Task 3).

---

## As built (2026-10-05, after execution and the final review) — read this before G2 and G3

Where this section and the task text below disagree, this section wins. The SDD ledger (git-ignored, in the worktree) holds every ruling R1 to R25.

- **Task 1:** UserPromptSubmit output is recorded as `attachment` type `hook_success`; `hookName` is always the literal `UserPromptSubmit`, so the ORDER of several hooks cannot be read from a transcript.
- **Task 4 (hook):** alert reasons are `unknown_arg, bad_holdout_rate, rules_unreadable, table_unreadable, log_failed, log_skipped_no_ids, bad_input, internal_error, adapter_timeout, adapter_cli_failed, adapter_bad_output, adapter_bad_input, adapter_internal_error` and the prefix `rules_skipped:`. The holdout flag is the joined form `--holdout-rate=<v>`. A steer over 4096 characters is rejected. The hook reads `EFFORT_STEERING_HOLDOUT_RATE` only; the planned `hooks.json` MUST set it, or production runs at rate 0 and has no holdout (route to Task 10).
- **Task 5 (`loadPrereg`):** `Prereg` also holds `alpha` (0<a<1), `permutations` (safe integer >=1) and `seed` (safe integer); `latencyBudgetMs` is a safe integer; each prompt needs at least two words and must not start with `-` or `/`; the bytes must equal the HEAD blob (no symlink; `git replace`, fsmonitor, lazy fetch and every `GIT_*` variable are neutralised). **G2 step 5 must also:** ask the operator for `alpha`, `permutations` and `seed`; add feasibility checks to the loader in the same commit (permutations >= 1/alpha - 1; alpha above the exact permutation floor `1 / prod C(r_i, h_i)`; `minPerArm` <= the planned arm totals; ruling R25); replace the null-template test with "the registered file loads and is committed, and `POLICY_TIMEOUT_MS === latencyBudgetMs`"; guard the timeout constant. Feasibility table (rate 0.4, exact floor, k prompts): 3 repeats k=4 1.2e-2, k=5 4.1e-3, k=8 1.5e-4; 4 repeats k=4 7.7e-4; 5 repeats k=4 1e-4. Alpha 0.05 is reachable at 4 prompts x 3 repeats but with power about 0.43 at a 30 percent reduction (gaussian noise CV 0.3); alpha 0.01 needs k>=5 at 3 repeats or >=4 repeats at k=4. Register `permutations` >= 10,000.
- **Task 6 (`analyzeArms`):** rows are `{ promptIndex, arm, thinking_tokens, cache_creation, input_total }`. The statistic is the mean over prompts (both arms present) of the direction-signed within-prompt delta; the p-value is a one-sided permutation test shuffling labels within each prompt, `permutations` draws, seeded, `p = (1 + count) / (1 + permutations)`. `mechanism_pass` iff the signed mean delta >= `effectSizeThinkingTokens` AND `p <= alpha`; `insufficient_data` if either arm's total n < `minPerArm` or no prompt contributes. It returns `nPrompts`, `perPrompt`, `signedDelta`, `pValue`; `cacheOk` is null unless both arms reach `minPerArm`. Independently re-derived: false-pass rate 0.0485 at alpha 0.05 over 224,000 no-effect trials.
- **Task 7 (`runExperiment(preregFile, opts)`):** the RUNNER assigns arms: per prompt `holdoutCount = clamp(round(repeats * holdoutRate), 1, repeats - 1)`, seeded shuffle, child env `EFFORT_STEERING_HOLDOUT_RATE` '1' (holdout) or '0' (treated). Order: `loadPrereg` -> clean `effort-steering/` tree -> explicit child env (whitelist; no `ANTHROPIC_*`, `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PROJECT_DIR`) -> steerability preflight of every prompt -> hook latency (log and stderr checked) -> `confirm` -> ONE excluded canary run -> main runs. `stop` reasons: `not_confirmed, dirty_tree, prompt_not_steerable, latency_not_ok, canary_failed, mechanism_fail, insufficient_data, verdict_unknown, cache_not_ok, runs_excluded`. Exclusion reasons: `no_log, no_transcript, ambiguous_transcript, spawn_failed, api_error, arm_mismatch, not_steered, steered_holdout, no_thinking_field`. The argv is `-p <options> --strict-mcp-config -- <prompt>`. Calls = prompts x repeats + 1 (the canary). The result records `treeCommit`, `preregCommit`, `childEnvKeys` and `endpoint`.
- **G3 message must tell the operator:** (1) the call count including the canary, the model and the registered gates; (2) each run leaves a transcript in `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<tmp-slug>/` and may add a project entry to `.claude.json`; none is cleaned; (3) `endpoint: 'default'` is asserted, not measured: the canary is the first real check that auth works with no `ANTHROPIC_*` (on this machine `ANTHROPIC_BASE_URL` is llm-proxy), that `--setting-sources local` keeps the user settings `env` out of the child, that `--strict-mcp-config` stops MCP servers, and that Claude Code passes `XDG_STATE_HOME` and the rate to the hook; (4) the canary is treated-only, so a dropped rate variable would make every holdout run `arm_mismatch` after the whole budget is spent; (5) no total wall-clock bound across the runs; (6) tee the result JSON (per-run rows are not persisted), and run each registration once (a second run of the same registration allows optional stopping); (7) optionally `--max-budget-usd` exists in `claude --help`.

## Order and gates

Tasks 1 to 4 and 8 need no model calls. Gates are the operator's: **G1** approves this plan; **G2** supplies the numbers of Task 5; **G3** approves the model-call run of Task 7; **G4** is the S4 verdict; **G5** approves the release.

| Task | Entry | Needs |
|---|---|---|
| 1 Hook-output replay | ES-4 (read-only half) | nothing |
| 2 Context builder | ES-3 | nothing |
| 3 Policy runner | ES-3 | Task 2 |
| 4 Hook entry | ES-3 | Tasks 2, 3 |
| 5 Preregistration | ES-5 | G2 |
| 6 Arm analysis | ES-5 | Task 5 |
| 7 S4 runner and run | ES-4, ES-5 | Tasks 1, 4, 5, 6, G3 |
| 8 Session-signal replay | ES-6 | nothing |
| 9 First rules | ES-9 | G4 or Task 8 result |
| 10 Package and release | ES-10 | G4, G5 |

---

### Task 1: Replay what transcripts record for `UserPromptSubmit`

Answers two unverified claims without a model call: how several hooks' `additionalContext` is ordered, and whether the hook fires for peer-message, task-notification and slash-command turns. Correction, measured while executing: `UserPromptSubmit` output is recorded as `attachment` records of type `hook_success` (`{type:"hook_success", hookName, hookEvent:"UserPromptSubmit", content}`, 35 transcript files), not `hook_additional_context`, which transcripts use for the other events. `hookName` is always the literal `UserPromptSubmit`, so the order of several hooks cannot be read from a transcript; only the live check of Task 7 Step 7 can answer the ordering question.

**Files:**
- Create: `effort-steering/spikes/s4a-hook-context-replay.mjs`
- Test: `effort-steering/spikes/s4a-hook-context-replay.test.mjs`

**Interfaces:**
- Consumes: `turnTrigger(obj)` and `realPromptText(obj)` from `effort-steering/spikes/s3-replay.mjs` (the turn collector there discards attachments, so the command-echo rule R9 is applied inside the replay).
- Produces: `export function replayHookContext(lines: string[]): { turns: number, withAttachment: number, multiHookTurns: number, orders: Record<string, number>, nonHumanWithAttachment: Record<'peer'|'task-notification'|'command', number> }`. `orders` maps a joined hook-name sequence such as `"A>B"` to its count.

- [ ] **Step 1: Write the failing test** with a synthetic jsonl (no real prompt text): one human prompt followed by two `UserPromptSubmit` attachments (`hookName` `A` then `B`), one peer-triggered record followed by a `UserPromptSubmit` attachment, one prompt with none. Assert `orders` equals `{ 'A>B': 1 }`, `multiHookTurns` equals 1, `nonHumanWithAttachment.peer` equals 1, `withAttachment` equals 2, and that a `PostToolUse` attachment is never counted.
- [ ] **Step 2: Run it and see it fail** (`node --experimental-strip-types effort-steering/spikes/s4a-hook-context-replay.test.mjs`): "replayHookContext is not a function".
- [ ] **Step 3: Implement `replayHookContext`** in the file above. Add a CLI entry that reads the top-level `*.jsonl` of every profile (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}` rule: iterate `.claude`, `.claude-sdd`, `.claude-kat` as S3 does) and prints the result as JSON with counts only.
- [ ] **Step 4: Run the test: PASS.** Then run the CLI once over the real transcripts.
- [ ] **Step 5: Record the numbers** in tracker ES-4 with `doc(action="update", id="af4ccc8b94a95c91", patch={body_edits:[...]})`. State plainly what remains open: the replay shows what transcripts record, not what the model sees, and it covers the existing hooks, not the new one.
- [ ] **Step 6: Commit** `feat(effort-steering): replay hook additionalContext from transcripts (ES-4)`.

### Task 2: Build the neutral context from hook input

**Files:**
- Create: `effort-steering/adapter/claude-code/build-context.mjs`
- Test: `effort-steering/adapter/claude-code/build-context.test.mjs`

**Interfaces:**
- Produces: `export function buildContext(hookInput: unknown): { prompt: string, session_id?: string, turn_id?: string, harness: 'claude-code', signals: {} }`. It never throws.

- [ ] **Step 1: Write the failing tests.** Full S1 shape (`session_id:'s1'`, `prompt_id:'p1'`, `prompt:'hi'`, plus `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`) gives `{prompt:'hi', session_id:'s1', turn_id:'p1', harness:'claude-code', signals:{}}`. `prompt_id` missing, a number, or `null` gives no `turn_id` key. `session_id` of `42` gives no `session_id` key. A prompt that contains the text `session_id: evil` leaves `session_id` unchanged. Input `null`, `[]`, `'x'` and `42` give `prompt:''` and `signals:{}`. A non-string `prompt` gives `''`.
- [ ] **Step 2: Run: FAIL** ("Cannot find module").
- [ ] **Step 3: Implement `buildContext`.** `permission_mode`, `cwd` and `transcript_path` are ignored in this version; Task 8 decides whether any becomes a signal.
- [ ] **Step 4: Run: PASS.**
- [ ] **Step 5: Commit** `feat(effort-steering): adapter context builder (ES-3)`.

### Task 3: Run the CLI with a wall-clock timeout

**Files:**
- Create: `effort-steering/adapter/claude-code/run-policy.mjs`
- Test: `effort-steering/adapter/claude-code/run-policy.test.mjs`

**Interfaces:**
- Consumes: `buildContext` output; the CLI `effort-steering/bin/effort-policy.mjs` (`decide`, one JSON line on stdout, keys `level, confidence, reasons, steer, arm`).
- Produces: `export const POLICY_TIMEOUT_MS = 2000` and `export function runPolicy(ctx: object, opts?: { cliPath?: string, timeoutMs?: number, args?: string[], env?: Record<string,string|undefined> }): { level: string, confidence: string, reasons: string[], steer: string | null, arm: string }`. It never throws. The default `cliPath` resolves from `import.meta.url` (`../../bin/effort-policy.mjs`), never from `CLAUDE_PLUGIN_ROOT`, because the scratch runs of Task 7 do not set it.
- Fail-open results all have `level:'default'`, `confidence:'low'`, `steer:null`, `arm:'treated'`, and one reason: `adapter_timeout` (killed at the timeout), `adapter_cli_failed` (spawn error or non-zero exit), `adapter_bad_output` (stdout is not exactly one JSON object line with the five keys).

`POLICY_TIMEOUT_MS = 2000` is a placeholder. The latency budget registered in Task 5 replaces it.

- [ ] **Step 1: Write the failing tests.** Use the copy-tree pattern of `effort-steering/bin/effort-policy.test.mjs` (copy `bin/` and `core/` into a temp dir, overwrite the copy's CLI). (a) Real CLI, `{prompt:'x'}`: result reasons `['no_rule']`. (b) Copy CLI that sleeps 5 s, `timeoutMs:200`: reasons `['adapter_timeout']`, elapsed under 1500 ms. (c) Copy CLI that exits 64: `['adapter_cli_failed']`. (d) Copy CLI that prints two lines, and one that prints `[1]`: `['adapter_bad_output']`. (e) After (b) the child process is gone (no orphan) and a log file written by a real `--log` run holds only whole JSON lines.
- [ ] **Step 2: Run: FAIL.**
- [ ] **Step 3: Implement `runPolicy`** with `spawnSync(process.execPath, [cliPath, 'decide', ...args], { input, timeout, killSignal:'SIGKILL', encoding:'utf8', maxBuffer })`. Validate the output with the five-key check.
- [ ] **Step 4: Run: PASS.** Mutation check: remove the `timeout` option; test (b) must fail.
- [ ] **Step 5: Commit** `feat(effort-steering): adapter policy runner with timeout (ES-3)`.

### Task 4: The hook entry

**Files:**
- Create: `effort-steering/adapter/claude-code/user-prompt-submit.mjs`
- Create: `effort-steering/adapter/claude-code/fixtures/hook-input.json` (S1 shape, synthetic text)
- Test: `effort-steering/adapter/claude-code/user-prompt-submit.test.mjs`

**Interfaces:**
- Consumes: `buildContext` (Task 2), `runPolicy` (Task 3).
- Produces: `export function handle(stdinText: string, env?: Record<string,string|undefined>): { output: object | null, alerts: string[] }`, plus a `main` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` that reads stdin, calls `handle`, prints `output` as one JSON line only when it is not null, writes each alert to stderr as `effort-steering: <reason>`, and always calls `process.exit(0)`, including when `handle` throws.
- `output` is `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: <steer> } }` exactly when `steer` is not null. `alerts` holds every reason in `unknown_arg, bad_holdout_rate, rules_unreadable, table_unreadable, log_failed, adapter_timeout, adapter_cli_failed, adapter_bad_output` and every reason that starts with `rules_skipped:`.
- Arguments passed to the CLI: always `--log`; `--holdout-rate <v>` only when `env.EFFORT_STEERING_HOLDOUT_RATE` is set. No other flag and no `--rules`/`--table` override exists in production.

- [ ] **Step 1: Write the failing tests** (process level for exit and stdout, `handle` level for the rest). (a) Fixture input with a copy-tree CLI whose default `rules.json` holds one high shallow rule matching everything: stdout is exactly one JSON line with `additionalContext` equal to `Answer directly without deliberating.`, exit 0. (b) Shipped empty rules: stdout empty, exit 0. (c) Prompt `ultrathink about x` with that rule: stdout empty (`user_override` adds no second sentence). (d) Stdin `{oops`, empty stdin and `[]`: stdout empty, exit 0. (e) Copy CLI that sleeps, tiny timeout via a test-only `handle` option: alerts include `adapter_timeout`, stdout empty, exit 0. (f) Review Focus 1: a 200 KB `prompt` finishes within the timeout and exits 0. (g) Review Focus 2: `XDG_STATE_HOME` points at a regular file: steering still in stdout, stderr holds `effort-steering: log_failed`, exit 0. (h) Review Focus 3: no `prompt_id`: decision made, stderr or alerts show `log_skipped_no_ids`, and the log dir holds no file. (i) A rules file with one bad rule adds a `rules_skipped:` alert. (j) Two concurrent runs with different `session_id` produce two files, each with one line. (k) No stderr or log line contains a probe substring of the prompt.
- [ ] **Step 2: Run: FAIL.**
- [ ] **Step 3: Implement** the module. Wrap `main` so that any exception ends in `process.exit(0)` with no stdout.
- [ ] **Step 4: Run: PASS.** Mutation checks: make `main` exit 2 on a bad stdin; (d) must fail. Print a debug line to stdout; (b) must fail.
- [ ] **Step 5: Commit** `feat(effort-steering): UserPromptSubmit adapter hook (ES-3)`. Do not add `hooks.json`.

### Task 5: Register the S4 gate numbers (needs G2)

**Files:**
- Create: `effort-steering/spikes/s4-prereg.json` (committed with `null` numbers)
- Create: `effort-steering/spikes/s4-prereg.mjs`
- Test: `effort-steering/spikes/s4-prereg.test.mjs`

**Interfaces:**
- Produces: `export function loadPrereg(file: string): Prereg`, where `Prereg = { direction: 'down'|'up', effectSizeThinkingTokens: number, latencyBudgetMs: number, holdoutRate: number, repeats: number, minPerArm: number, model: string, prompts: string[], steerLevel: 'shallow'|'deep' }`. It throws when any field is missing or null, `effectSizeThinkingTokens <= 0`, `holdoutRate` is not in (0, 1), `repeats < 3`, `minPerArm < 3`, fewer than 4 prompts, `direction` does not match `steerLevel` (`shallow` is `down`, `deep` is `up`), or the file is not tracked by git or differs from `HEAD` (a number changed after it was registered).

- [ ] **Step 1: Write the failing tests** with a temp git repo: valid committed file loads; each invalid case above throws a message naming the field; an uncommitted file throws "not committed"; a file edited after commit throws "differs from HEAD".
- [ ] **Step 2: Run: FAIL.**
- [ ] **Step 3: Implement `loadPrereg`** (`git ls-files --error-unmatch`, `git diff --quiet HEAD -- <file>`).
- [ ] **Step 4: Run: PASS.** Commit the template with `null` numbers: `docs(effort-steering): S4 preregistration template`.
- [ ] **Step 5: STOP for G2.** Ask the operator for: the effect size in `thinking_tokens`, the latency budget in ms, the holdout rate, repeats, `minPerArm`, the model, the prompt set and the steer level to test. Fill the file, commit it (`docs(effort-steering): register S4 gates`), and only then continue. Set `POLICY_TIMEOUT_MS` in Task 3's file to the registered latency budget in the same commit.

### Task 6: Analyze the arms

**Files:**
- Create: `effort-steering/spikes/s4-analyze.mjs`
- Test: `effort-steering/spikes/s4-analyze.test.mjs`

**Interfaces:**
- Consumes: `Prereg` (Task 5).
- Produces: `export function analyzeArms(rows: Array<{ arm: 'treated'|'holdout', thinking_tokens: number, cache_creation: number, input_total: number }>, prereg: Prereg): { nTreated: number, nHoldout: number, nIgnored: number, medianTreated: number | null, medianHoldout: number | null, delta: number | null, cacheShareTreated: number | null, cacheShareHoldout: number | null, cacheOk: boolean | null, verdict: 'mechanism_pass'|'mechanism_fail'|'insufficient_data' }`. As built (rulings R18, R19): invalid rows (unknown arm, non-finite or negative numbers, `cache_creation > input_total`) are excluded and counted in `nIgnored`; `delta` and `cacheOk` are `null` unless BOTH arms reach `minPerArm`; a share or median is `null` for an arm with no rows; `input_total` is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the session (ruling R3).
- `delta = medianTreated - medianHoldout`. For `direction:'down'` the mechanism passes when `-delta >= effectSizeThinkingTokens`; for `'up'` when `delta >= effectSizeThinkingTokens`. Either arm below `minPerArm` gives `insufficient_data`. `cacheShare = sum(cache_creation) / sum(input_total)` per arm (0 when the sum is 0). `cacheOk` is `cacheShareTreated <= cacheShareHoldout`.

- [ ] **Step 1: Write the failing tests** with exact vectors. Treated medians 100 against holdout 300, effect size 150, `down`: `mechanism_pass`. Same data with `up`: `mechanism_fail`. Swap the arm labels: verdict flips. Delta exactly equal to the effect size passes; one token short fails. Two treated rows with `minPerArm:3`: `insufficient_data`. Cache share higher in treated: `cacheOk:false`. Empty input: `insufficient_data`, no NaN.
- [ ] **Step 2: Run: FAIL.**
- [ ] **Step 3: Implement `analyzeArms`.**
- [ ] **Step 4: Run: PASS.** Mutation checks: use `>` for `>=`; swap `treated` and `holdout`; drop the direction check. Each must fail a test.
- [ ] **Step 5: Commit** `feat(effort-steering): S4 arm analysis (ES-5)`.

### Task 7: The S4 runner, the merge check and the run (needs G3)

**Files:**
- Create: `effort-steering/spikes/s4-run.mjs`
- Test: `effort-steering/spikes/s4-run.test.mjs`

**Interfaces:**
- Consumes: `loadPrereg`, `analyzeArms`, `replayHookContext`, the S2 usage-report dedupe by `message.id`.
- Produces: `export function planRuns(prereg: Prereg): Array<{ sessionId: string, prompt: string }>` (`prompts × repeats` entries, a fresh UUID per entry); `export function measureHookLatency(prereg: Prereg, opts?: { spawn?: Function }): { n: number, p95Ms: number, ok: boolean }` (no model call: it runs the real hook script `prompts × repeats` times on the registered prompts, wall-clock per run, `ok = p95Ms <= prereg.latencyBudgetMs`; this is the registered latency gate, which the spec lists beside the mechanism and cache gates); `export async function runExperiment(preregFile: string, opts: { spawn?: Function, confirm: boolean }): Promise<{ verdict: string, analysis: object, latency: object, excluded: number, excludedByReason: { no_log: number, no_transcript: number, spawn_failed: number, api_error: number, ambiguous_transcript: number }, stop: string[], gitCommit: string | null }>`. It takes the prereg FILE PATH and calls `loadPrereg(preregFile)` first, before anything else (ruling R21). Without `opts.confirm === true` it prints the number of model calls and returns without spawning anything. Latency is measured before any `claude` call, and when it is not ok no `claude` call is made (ruling R23e). As built, `stop` holds every reason to stop: `mechanism_fail`, `insufficient_data`, `verdict_unknown`, `cache_not_ok` (when `analysis.cacheOk !== true`), `latency_not_ok`, `runs_excluded` (when any run was excluded); it is empty only when the verdict is `mechanism_pass`, `cacheOk` is true, the latency gate holds and no run was excluded. A run is excluded when its spawn failed (error, signal or non-zero status), when its session holds an API-error record (`isApiErrorMessage` or model `<synthetic>`), or when its log or transcript is missing or ambiguous (ruling R22). The prereg's git commit (`git rev-parse HEAD` of the file's repo) is recorded in the result so the registration is traceable.
- Each run calls `claude -p <prompt> --model <prereg.model> --session-id <uuid> --setting-sources local --settings <scratch file>` from a temp directory. The scratch settings register one `UserPromptSubmit` command that points at a **copy** of `effort-steering/` whose default `rules.json` holds one rule that matches every prompt at the confidence the steer level needs (`high` for `shallow`, `medium` for `deep`), and set `EFFORT_STEERING_HOLDOUT_RATE` to `prereg.holdoutRate`. Do not use `--no-session-persistence`: the transcript is the measurement. The arm of a row comes from the session's decision-log file; the tokens come from its transcript, found by globbing `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/<sessionId>.jsonl` (ruling R6; the project slug is not computed); the join key is the session id. A run with no log file or no transcript is excluded and counted in `excluded`, never treated as holdout.

- [ ] **Step 1: Write the failing tests** with an injected `spawn`. `planRuns` returns `prompts.length × repeats` entries with distinct session ids. `runExperiment` with an uncommitted prereg throws before `spawn` is called (zero calls). Without `confirm`, zero calls and a printed count. With `confirm`, each call carries `--setting-sources local`, `--session-id`, the registered model, and no `--no-session-persistence`. A run whose log file or transcript is missing is excluded from the rows and counted in `excluded`, not treated as holdout. `stop` contains `cache_not_ok` for `mechanism_pass` with `cacheOk:false`, `insufficient_data` for short arms, and `latency_not_ok` when `p95Ms` exceeds the budget; each stop reason has its own test and a mutation (drop it from `stop`) that fails one. `measureHookLatency` uses an injected clock/spawn so the p95 is exact in the test.
- [ ] **Step 2: Run: FAIL.**
- [ ] **Step 3: Implement** `planRuns` and `runExperiment`.
- [ ] **Step 4: Run: PASS.** Mutation check: remove the `loadPrereg` call; the zero-calls test must fail.
- [ ] **Step 5: Commit** `feat(effort-steering): S4 runner (ES-5)`.
- [ ] **Step 6: STOP for G3.** Tell the operator the number of model calls, the model and the registered gates. Run only after an explicit yes: `node --experimental-strip-types effort-steering/spikes/s4-run.mjs --confirm`.
- [ ] **Step 7: The merge check (ES-4).** Run one extra scratch call with `--setting-sources user,local` so buddy and `constitution-brief` also fire. Feed its transcript to `replayHookContext`. Record the order and the format of the merged context in tracker ES-4, and whether the steering text is cache-neutral from the S5 numbers of Step 6.
- [ ] **Step 8: Record the verdict** in tracker ES-5 (gate numbers, the prereg commit, `analysis`, `latency`, `excluded`, `verdict`, `stop`). If `stop` is not empty, stop and report every reason. Do not reopen the settings write without the operator, and do not proceed to Task 9 or Task 10 on any non-empty `stop`.

### Task 8: Replay the session signals (ES-6)

**Files:**
- Modify: `effort-steering/spikes/s3-replay.mjs` (add the signals; keep its exports)
- Test: `effort-steering/spikes/s3-replay.test.mjs`

**Interfaces:**
- Produces: each measured turn also carries `prevTurnFailed: boolean` (the previous measured turn held at least one `tool_result` with `is_error: true`) and `planMode: boolean | null` (`null` when the transcript has no field for it). Step 1 decides the field.

- [ ] **Step 1: Find the plan-mode field.** Grep the transcripts for `permissionMode` and `permission_mode` on user records and list the values seen. If none reaches transcripts, set `planMode` to `null` and say so in ES-6. Do not guess.
- [ ] **Step 2: Write the failing tests** with a synthetic jsonl: a turn after an `is_error` result has `prevTurnFailed:true`; the first turn has `false`; a table groups median and p90 by `prevTurnFailed` with `n` shown.
- [ ] **Step 3: Implement**, then run: PASS.
- [ ] **Step 4: Run it once** over the three profiles and record in ES-6 whether `prevTurnFailed` separates thinking depth (medians and `n`). `retryCount` has no mechanical definition in the spec; list it as not measured.
- [ ] **Step 5: Commit** `feat(effort-steering): session-signal replay (ES-6)`.

### Task 9: First rules (ES-9; held until G4 or Task 8)

Entry condition: Task 7's verdict is `mechanism_pass`, or Task 8 shows a signal that separates depth with usable `n`. Without one of these, stop.

**Files:**
- Modify: `effort-steering/core/rules.json`
- Test: `effort-steering/core/rules.shipped.test.mjs`

- [ ] **Step 1: Ask the operator which rules** (the spec says the operator reviews them before they freeze). Each rule has an id, a level, a confidence class and a `when`.
- [ ] **Step 2: Write the failing tests:** per rule one positive prompt and one near-miss negative that resembles another rule's cue; precedence between the shipped rules; every regex reviewed for nested quantifiers and run against a 30-character adversarial string with a time limit.
- [ ] **Step 3: Add the rules; run: PASS.** The existing test that asserts the shipped file compiles with the probe on and skips nothing must still pass. Update the old test "the shipped rules.json is empty".
- [ ] **Step 4: Commit** `feat(effort-steering): first rules (ES-9)`.

### Task 10: Package and release (ES-10; needs G4 and G5)

**Files:**
- Create: `effort-steering/.claude-plugin/plugin.json`, `effort-steering/hooks/hooks.json`
- Modify: `.claude-plugin/marketplace.json` (entry, no version field), `README.md` (version-table row)
- Delete: `effort-steering/spikes/`
- Test: `tests/test-effort-steering-package.sh`

- [ ] **Step 1: Write the failing test.** `tests/test-effort-steering-package.sh`: (a) no file under `effort-steering/` outside `spikes/` contains `/home/` or a profile directory literal; (b) `effort-steering/hooks/hooks.json` has a `UserPromptSubmit` command that uses `${CLAUDE_PLUGIN_ROOT}` and names `adapter/claude-code/user-prompt-submit.mjs`; (c) `marketplace.json` has an `effort-steering` entry with no `version` key. The existing sweep `tests/test-all-plugins-hooks-json-portable.sh` finds every `hooks/hooks.json` by `find`, so it needs no edit; confirm that it then lists the new file. Run: FAIL.
- [ ] **Step 2: Create the manifest and `hooks.json`.** The `UserPromptSubmit` command is `node ${CLAUDE_PLUGIN_ROOT}/adapter/claude-code/user-prompt-submit.mjs`. Add the marketplace entry and the README row.
- [ ] **Step 3: Delete `effort-steering/spikes/`.** The findings document already cites the commits. Update the tracker entries that name spike files.
- [ ] **Step 4: Run `./tests/run-all.sh` and `./scripts/check-versions.sh`: PASS.** Commit `feat(effort-steering): package as a plugin (ES-10)`.
- [ ] **Step 5: STOP for G5.** After approval run `./scripts/release.sh effort-steering minor`, then the two manual steps from the repo `CLAUDE.md`: refresh the `version-bump-checklist` tracker (`doc(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)`, every row ✅) and cold-restart all three Claude Code instances. Confirm `source=startup` in a SessionStart payload.

---

## Self-review

- **Spec coverage:** D1 (adapter over core: Tasks 2 to 4), D2 (steering text, no settings write: Task 4, global constraints), D5 (holdout measurement: Tasks 5 to 7), D6 (standalone plugin: Task 10), the four adapter constraints (timeout Task 3, exit 0 and ids Tasks 2 and 4, alerting Task 4), the gate list (mechanism, cache, latency: Tasks 5 and 6; stop rule: Task 7 Step 8), the build constraints (ES-7 and ES-8 are done; spike deletion and the `rules.json` review: Tasks 9 and 10). ES-11 is not in this plan; it belongs to the push-and-deploy session.
- **Open and deliberately not decided here:** the gate numbers (G2), the first rules (G4), and whether `permission_mode` becomes a signal (Task 8, Step 1).
- **Unverified before this plan:** that `claude -p --session-id` writes a transcript at a predictable path; Task 7 Step 3 must confirm it before the first run.
- **Types:** `Prereg`, `buildContext`, `runPolicy`, `handle`, `planRuns`, `analyzeArms` and `replayHookContext` have one signature each, defined once in the task that produces them.
