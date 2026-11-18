# Effort routing first rule R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the instrument that produces a ship or no-ship answer for rule R1 (`hasStackTrace` → `shallow` → effort `low`): trace prompts for the 16 built S5 tasks, a work root that runs them through the unchanged S5 runner, a registration, and an analysis. Stop at the operator's stage gates.

**Architecture:** A new spike directory `effort-steering/spikes/r1/` holds pure modules with unit tests. The S5 runner, grader and prereg loaders stay unchanged. The trace prompt replaces `prompt.txt` in a reflink copy of each built task (a second work root), so the S5 work root stays intact. The run uses the existing `calibrate` mode, whose config loader (`loadS5Config`) allows `runs: 0` for an arm.

**Tech Stack:** Node ESM (`.mjs`), `node:assert/strict`, the `t()` helper of `effort-steering/core/testkit.mjs`, Docker via the S5 modules, btrfs reflinks.

**Spec:** `docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md`. Related: `docs/superpowers/specs/2026-10-07-effort-steering-quality-test-design.md`, `effort-steering/spikes/s5/README.md`.

## Global Constraints

- R1 is a **candidate**. Do not edit `effort-steering/core/rules.json` (it stays `{"version":1,"rules":[]}`) in this plan. Shipping R1 is the operator's decision after the result.
- Margin `0.15`, one-sided alpha `0.05`. Two runs per usable task and arm. Effort: arm C `low`, arm A `xhigh`, no steer in either.
- No model call happens before the stage 1 gate. Stage 1 is about 32 runs, about $6. Stage 2 is about 32 runs, about $34, and runs only if C failed somewhere. Each stage needs the operator's approval; **this plan stops at each gate and asks.**
- Stage 0 stops if fewer than 12 of the 16 tasks have a usable prompt.
- The prereg file is committed **before stage 1**. Stage 2 runs arm A on every usable task, never only on tasks where C failed.
- Nothing is pushed. Commit with explicit paths (`git add <path>`), never `git add -A`.
- Verify with `./tests/run-all.sh` (it finds `effort-steering/**/*.test.mjs` at any depth).
- Throwaway spike code: no `plugin.json`, no marketplace entry (ES-10).

## Review Focus

- A trace with no frame lines (a bare panic message): `hasStackTrace` is false, so the prompt must be rejected, not used. Pinned in Task 2.
- A very long test output: the prompt must be cut at a line boundary below the cap and must still hold frame lines. Pinned in Task 2.
- R1 at confidence below `high`: `decide.mjs` turns every shallow decision below `high` into `default` (`guard_shallow`), so the rule would never fire. Pinned in Task 1.
- A prompt that holds a scrub term or `ultrathink`: must be rejected. Pinned in Task 2.
- A task whose run was lost to infrastructure in one arm: it is dropped from both arms, and fewer than 2 included tasks gives `insufficient`, not a bound. Pinned in Task 6.

## Verified seams (scouted 2026-10-13)

- `decide.mjs`: rules need `id`, `level` in `{shallow, deep}`, `confidence`, optional `reason`, and `when` with at least one known key. `hasStackTrace` is a boolean key. A `shallow` result needs top confidence `high` and `signals.prevTurnFailed` false, else the result is `default`/`guard_shallow`.
- The spec says the runner takes a prompt "in place of `TASK.md`". The code differs: the first user message is `<workRoot>/tasks/<id>/prompt.txt`. `TASK.md` is inside the agent's tree and stays. `run.mjs` `loadTask` refuses a `prompt.txt` whose sha256 is not `manifest.promptHash`.
- `loadS5Prereg` (the `measure` loader) needs B ≥ 2 runs and refuses an arm with 0 runs. `loadS5Config(file, { mode: 'calibrate' })` allows 0. Precedent: `~/work/claude/s5-work/configs/calibrate-batch2.json` (arms A 2, B 0, C 1).
- `analyze.mjs` `perTaskScores` excludes a task that lacks a counted run in arm B. This experiment has no arm B, so it cannot be reused. `isCounted`, `isPass` and `pairedLowerBound` are exported and fit.
- `gradeTree(manifest, treeDir, { workRoot, image, cpus, memoryGb, runId })` keeps its grade directory (with `results/f2p.out`) when `S5_KEEP_GRADES=1`. It sets no `RUST_BACKTRACE`; an `env RUST_BACKTRACE=1` argv prefix on `def.f2p.command` supplies it.
- `reflinkCopy(src, dst)` is exported from `build-task.mjs` and refuses an existing `dst`. `/home` is btrfs, so reflinks work. The 16 built tasks (`cs-p01 02 04 05 06 07 08 10 11 12 15 16 17 18 19 20`) are all gate-ok in `~/work/claude/s5-work/tasks/`.

## File Structure

| File | Responsibility |
|---|---|
| `effort-steering/spikes/r1/r1-rule.mjs` + `.test.mjs` | the R1 rule entry |
| `effort-steering/spikes/r1/r1-prompt.mjs` + `.test.mjs` | trace extraction, prompt building, prompt checks |
| `effort-steering/spikes/r1/r1-stage0.mjs` + `.test.mjs` | capture the f2p output at P for one task |
| `effort-steering/spikes/r1/r1-workroot.mjs` + `.test.mjs` | build the second work root |
| `effort-steering/spikes/r1/r1-analyze.mjs` + `.test.mjs` | per-task scores, the screen, the paired bound, the verdict |
| `effort-steering/spikes/r1/r1-sim.mjs` + `.test.mjs` | planted-truth simulation of the two-stage decision |
| `effort-steering/spikes/r1/r1-prereg.mjs` + `.test.mjs` | write the registration, derive stage configs, check it is committed |
| `effort-steering/spikes/r1/r1.mjs` | CLI: `stage0`, `workroot`, `prereg`, `stage-config`, `analyze`, `sim` |
| `effort-steering/spikes/r1/README.md` | runbook and the limits the report must state |
| `effort-steering/spikes/s5/analyze.mjs` | modify: `export` the existing `lostRunArms` |

---

### Task 1: The R1 rule entry

**Files:**
- Create: `effort-steering/spikes/r1/r1-rule.mjs`
- Test: `effort-steering/spikes/r1/r1-rule.test.mjs`

**Interfaces:**
- Produces: `R1_RULE` (frozen `{ id: 'r1-stack-trace-shallow', level: 'shallow', confidence: 'high', reason: string, when: { hasStackTrace: true } }`) and `R1_RULES` (frozen `{ version: 1, rules: [R1_RULE] }`, the shape `compileRules` takes).

- [ ] **Step 1: Write the failing test.** Tests (use `compileRules(R1_RULES)` and `decide({ prompt, signals }, compiled)`):
  - `t('R1 compiles with the slow-regex probe on and skips nothing')`: `compileRules(R1_RULES).skipped` deep-equals `[]`.
  - `t('a Python traceback gives shallow/high with the rule id')`: result deep-equals `{ level: 'shallow', confidence: 'high', reasons: ['r1-stack-trace-shallow'] }`. Same for a Node frame (`'Error: x\n    at run (/a/b.js:1:2)\n'`) and a Rust backtrace (`'thread \'t\' panicked at src/lib.rs:3:1:\nboom\nstack backtrace:\n   0: f\n             at ./src/lib.rs:34:9\n'`).
  - `t('a bare Rust panic message does not fire')`: a panic line with no `at …:N:N` frame gives `{ level: 'default', confidence: 'low', reasons: ['no_rule'] }`.
  - `t('ultrathink with a trace is still deep')`: reasons `['user_override']`.
  - `t('a failed previous turn turns R1 off')`: `signals: { prevTurnFailed: true }` with a trace gives `default` and `reasons[0] === 'guard_shallow'`.
  - `t('R1 needs confidence high')`: the same rule with `confidence: 'medium'` gives `default`/`guard_shallow` (pins why `high` is required).
- [ ] **Step 2: Run it and see it fail.** Run: `node effort-steering/spikes/r1/r1-rule.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `R1_RULE` and `R1_RULES` in `r1-rule.mjs`** with `Object.freeze` (the style of `HOOK_RULES` in `spikes/s5/hook-copy.mjs`). The `reason` text: `'a pasted stack trace marks a fix with exact expected values'`.
- [ ] **Step 4: Run it and see it pass.** Same command. Expected: all `t()` cases pass.
- [ ] **Step 5: Commit.** `git add effort-steering/spikes/r1/r1-rule.mjs effort-steering/spikes/r1/r1-rule.test.mjs` then `git commit -m "feat(effort-steering): R1 candidate rule (stack trace to shallow), not shipped"`.

### Task 2: Trace extraction, prompt building and prompt checks

**Files:**
- Create: `effort-steering/spikes/r1/r1-prompt.mjs`
- Test: `effort-steering/spikes/r1/r1-prompt.test.mjs`

**Interfaces:**
- Consumes: `extractFeatures` (`core/features.mjs`), `decide`, `compileRules` (`core/decide.mjs`), `R1_RULES` (Task 1).
- Produces:
  - `traceFromTestOutput(output: string, opts?: { maxChars?: number }) -> string | null`. `maxChars` default `8000`.
  - `buildTracePrompt(trace: string, instruction?: string) -> string`. Default `instruction` is `'This is the failing test output. Please fix it.'`. Result is `trace.trimEnd() + '\n\n' + instruction + '\n'`.
  - `checkTracePrompt(prompt: string, def: { scrub?: { terms?: string[] }, f2p: { names: string[] } }) -> { ok: boolean, reasons: string[], f2pNamesShown: boolean }`.

`traceFromTestOutput` rule: keep the text from the first line that matches `/^---- .+ stdout ----$/` up to (not including) the last line equal to `failures:` when more than one such line exists, else to the end. Cut to `maxChars` at a line boundary. Return `null` when no `----` header exists.

`checkTracePrompt` reasons, each at most once, in this order: `no_stack_trace` (`extractFeatures(prompt).hasStackTrace` is false), `not_shallow` (`decide({ prompt }, compileRules(R1_RULES)).level !== 'shallow'`), `ultrathink` (`extractFeatures(prompt).explicitDeep`), `leak:<term>` per scrub term found case-insensitively, `not_utf8_or_nul` (the UTF-8 round trip differs or a NUL byte exists). `f2pNamesShown` is true when any `def.f2p.names` entry occurs in the prompt; it is information for the leak review and never a reason.

- [ ] **Step 1: Write the failing tests** with a libtest fixture string (a `running 1 test` line, `failures:`, a `---- x::y stdout ----` block with `thread … panicked at src/lib.rs:34:9:`, `stack backtrace:` and `   0: f\n             at ./src/lib.rs:34:9`, a second `failures:` and `    x::y`, then `test result: FAILED`):
  - `traceFromTestOutput` keeps the `----` block and its frames and drops the `running` line and the trailing name list.
  - It returns `null` for output with no `----` header.
  - A 100000-character block with frames: the result is at most `8000` characters, ends at a line boundary, and `extractFeatures(result).hasStackTrace` is true.
  - `buildTracePrompt(trace)` ends with the default instruction and one newline.
  - `checkTracePrompt` returns `{ ok: true, reasons: [], f2pNamesShown: false }` for a clean prompt with frames; `['no_stack_trace', 'not_shallow']` for a panic-only prompt; `['ultrathink']` for a prompt with frames plus the word `ultrathink`; `['leak:secret_term']` when a scrub term occurs in different case; `['not_utf8_or_nul']` for a prompt holding `\0`.
  - `f2pNamesShown` is true when the prompt holds an f2p name, and `ok` stays true.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-prompt.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the three functions in `r1-prompt.mjs`** to the rules above.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit** `git add effort-steering/spikes/r1/r1-prompt.mjs effort-steering/spikes/r1/r1-prompt.test.mjs`; message `feat(effort-steering): R1 trace prompt builder and checks`.

### Task 3: Capture the f2p output at P

**Files:**
- Create: `effort-steering/spikes/r1/r1-stage0.mjs`, `effort-steering/spikes/r1/r1.mjs` (CLI with the `stage0` subcommand only for now)
- Test: `effort-steering/spikes/r1/r1-stage0.test.mjs`

**Interfaces:**
- Consumes: `gradeTree`, `removeGradeDir` (`spikes/s5/grade.mjs`), `traceFromTestOutput`, `buildTracePrompt`, `checkTracePrompt` (Task 2).
- Produces:
  - `captureTrace(manifest, { workRoot, image, cpus, memoryGb, grade = gradeTree }) -> Promise<string>`: refuses `manifest.def.testRunner !== 'cargo'`. It runs `grade` on a copy of the manifest whose `def.f2p.command` is `['env', 'RUST_BACKTRACE=1', ...def.f2p.command]`, on `<workRoot>/tasks/<id>/tree`, with `runId: 'r1-<id>'`, and with `process.env.S5_KEEP_GRADES = '1'` set only for the call (restore the old value in `finally`). It reads `<kept>/results/f2p.out`, removes `kept` with `removeGradeDir`, and returns the text. It throws when `grade` returns no `kept`.
  - CLI: `node effort-steering/spikes/r1/r1.mjs stage0 --work-root <dir> --out-root <dir> [--tasks <ids>] [--cpus 4] [--memory-gb 8]`. For each task it writes `<out-root>/stage0/<id>.f2p.out`, `<id>.prompt.txt` and, at the end, `report.json` = `[{ id, ok, reasons, f2pNamesShown, chars, promptSha256 }]`. It prints a line per task and exits 1 when fewer than 12 tasks are `ok`. Image: `IMAGE_FOR_REPO[manifest.repo]` (`spikes/s5/task-def.mjs`).

- [ ] **Step 1: Write the failing test** `captureTrace` with a fake `grade` that creates `<tmp>/kept/results/f2p.out` with the Task 2 fixture and returns `{ kept }`. Assert: the fake saw `def.f2p.command` starting `['env', 'RUST_BACKTRACE=1']`; the fake saw `process.env.S5_KEEP_GRADES === '1'` and the variable is restored afterwards; the returned text equals the file; `kept` is removed; a non-cargo manifest throws.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-stage0.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `captureTrace` and the `stage0` CLI.** Follow the argument parsing and exit-code conventions of `spikes/s5/s5.mjs` (64 for a usage error, 1 for a refusal).
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Real check on one task (no model call).** Run: `node effort-steering/spikes/r1/r1.mjs stage0 --work-root ~/work/claude/s5-work --out-root ~/work/claude/s5-work-r1 --tasks cs-p19`. Expected: `cs-p19.prompt.txt` exists, `report.json` lists `cs-p19` with `ok: true`, and the prompt holds `stack backtrace:` and an `at …:N:N` line. **If the backtrace has no frame lines, stop and report: the tests may need `debug = true` or the image has no `env`. Do not work around it silently.**
- [ ] **Step 6: Commit** the three files with message `feat(effort-steering): capture f2p output at P for R1 trace prompts`.

### Task 4: Stage 0 on all 16 tasks and the leak review

**Files:** none in the repository. Output goes to `~/work/claude/s5-work-r1/stage0/`.

- [ ] **Step 1: Run Stage 0.** `node effort-steering/spikes/r1/r1.mjs stage0 --work-root ~/work/claude/s5-work --out-root ~/work/claude/s5-work-r1`. Expected: 16 lines, exit 0 when at least 12 are `ok`. If exit 1: stop and report the reasons per task to the operator. This is the spec's stop rule.
- [ ] **Step 2: Dispatch the leak review to an Opus subagent** (the repository's rule for load-bearing review). Brief it with: the spec section "The lab prompt" and "Open problem", the path of each `<id>.prompt.txt`, each task's `TASK.md` and `task.json` (`scrub.terms`), and the question per task: does the prompt (V1, a raw trace of a hidden test) give the agent anything that `TASK.md` does not, such as the fix, the root cause, a test name that describes the fix, or an assertion text that names the new behaviour? It answers `ok`, `leak` or `unfair` with one reason per task. Tell it to read the files, not to infer. Write the verdicts to `~/work/claude/s5-work-r1/stage0/review.json` as `{ "<id>": "ok" | "leak" | "unfair" }`.
- [ ] **Step 3: Apply the rule.** Usable = `report.ok` and review `ok`. If fewer than 12 are usable: stop and give the operator the V2/V3 choice (spec "Open problem"). Do not build V2 without the operator.
- [ ] **Step 4: Record** the usable list and the verdict reasons in the ES-22 section of `docs/trackers/effort-steering-second-phase.md` with `doc(action="append_entry", …)` or the heading edit that tracker's conventions require (read `get_guide("tracker-conventions")` first).

### Task 5: The R1 work root

**Files:**
- Create: `effort-steering/spikes/r1/r1-workroot.mjs`
- Modify: `effort-steering/spikes/r1/r1.mjs` (add `workroot`)
- Test: `effort-steering/spikes/r1/r1-workroot.test.mjs`

**Interfaces:**
- Consumes: `reflinkCopy`, `hashBuiltTask` (`spikes/s5/build-task.mjs`).
- Produces: `buildR1Root({ srcRoot, dstRoot, tasks: [{ id, promptFile }], copy = reflinkCopy }) -> { tasks: [{ id, treeHash, hiddenHash, promptHash }] }`.

For each task: `copy(<srcRoot>/tasks/<id>, <dstRoot>/tasks/<id>)`; write the prompt file's bytes to `<dst>/tasks/<id>/prompt.txt`; set `manifest.promptHash` (sha256 of those bytes) in `<dst>/tasks/<id>/manifest.json`, keeping every other field; check that `hashBuiltTask(<dst task dir>)` equals `{ treeHash, hiddenHash }` of the source manifest plus the new `promptHash`. Also `copy(<srcRoot>/cargo-home, <dstRoot>/cargo-home)` once. Refuse an existing `dstRoot/tasks/<id>` (`reflinkCopy` already does). `gate.json` is copied unchanged: it holds only tree and hidden hashes.

- [ ] **Step 1: Write the failing test** with a small fake source root (task dir with `tree/a.txt`, `hidden/`, `prompt.txt`, `manifest.json`, `gate.json`; a `cargo-home/`), `copy` injected as a recursive `cpSync`. Assert: the new `prompt.txt` bytes are the trace; `manifest.promptHash` equals their sha256; `treeHash` and `hiddenHash` are unchanged; the source task dir is byte-identical to before; `hashBuiltTask` of the new dir matches the manifest.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-workroot.test.mjs`.
- [ ] **Step 3: Implement `buildR1Root` and the `workroot` subcommand** (`--src-root`, `--dst-root`, tasks read from `stage0/report.json` filtered by `stage0/review.json`).
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Build the real root.** Run the `workroot` subcommand. Expected: one line per usable task; `du -sh ~/work/claude/s5-work-r1` is small (reflinks); `node effort-steering/spikes/s5/s5.mjs gate <id> --work-root ~/work/claude/s5-work-r1 --cpus 4 --memory-gb 8` is **not** needed, because the tree and the hidden tests are unchanged. Task 8 step 5 checks the new manifests with `checkTasksMatch`.
- [ ] **Step 6: Commit** the three code files; message `feat(effort-steering): R1 work root with trace prompts`.

### Task 6: The analysis

**Files:**
- Modify: `effort-steering/spikes/s5/analyze.mjs` (add `export` to `lostRunArms`; no other change)
- Create: `effort-steering/spikes/r1/r1-analyze.mjs`
- Test: `effort-steering/spikes/r1/r1-analyze.test.mjs`

**Interfaces:**
- Consumes: `isCounted`, `isPass`, `pairedLowerBound`, `lostRunArms` (`spikes/s5/analyze.mjs`).
- Produces: `analyzeR1(rows: Row[], prereg) -> Report` where `Report = { margin, alpha, method, stage: 1 | 2, included: [{ taskId, C, A | null, nC, nA }], excluded: [{ taskId, reason }], failedC: string[], d: { mean, lower } | null, verdict: 'support' | 'needs_stage_2' | 'not_shown_safe' | 'insufficient', reason: string | null }`. `prereg` is what `loadS5Config` returns. The function throws when two counted rows share a `runId`, as `analyzeS5` does.

Rules:
- `stage` is 2 when any counted row has arm `A`, else 1. Rows of arm `B` are ignored.
- A task is excluded when `lostRunArms(rows)` names it (reason `infra_exhausted_in_<arms>`) or when it has no counted C run (`no_counted_run_in_C`); in stage 2 also when it has no counted A run (`no_counted_run_in_A`). Exclusion applies to the whole task.
- Fewer than 2 included tasks gives `insufficient`.
- Stage 1: every included task has `C === 1` → `support`; else `needs_stage_2` and `failedC` lists the tasks with `C < 1`.
- Stage 2: `d_i = C_i - A_i`; `d = pairedLowerBound(diffs, { method, resamples, seed, alpha })` with `method`, `resamples` and `seed` from `prereg.bound` and `alpha` from `prereg.alpha`; `support` iff `d.lower > -prereg.margin` (strict), else `not_shown_safe`.

- [ ] **Step 1: Write the failing tests.** Row helper `row(taskId, arm, rep, pass, over)` giving `{ taskId, arm, runId: '<task>.<arm>.<rep>', final: true, infra: null, grade: { pass } }`. Tests: stage 1 all C pass → `support`, `d === null`; stage 1 one C fail → `needs_stage_2` with `failedC`; stage 2 all tied → `d.lower === 0` and `support`; stage 2 one task C 0 of 2 and A 2 of 2 over 16 tasks with the registered `paired-t` → compute the expected `lower` in the test with the same `pairedLowerBound` call and assert the verdict follows the strict comparison; a lost run (`final: true, infra: 'infra_exhausted'`) drops the task from both arms; 1 included task → `insufficient`; a boundary test with a hand-built `diffs` whose `lower` is exactly `-0.15` is `not_shown_safe`; duplicate counted `runId` throws; rows of arm `B` change nothing.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-analyze.test.mjs`.
- [ ] **Step 3: Implement `analyzeR1`** (and add `export` to `lostRunArms`; run `node effort-steering/spikes/s5/analyze.test.mjs` to see it still passes).
- [ ] **Step 4: Run both test files; expect PASS.**
- [ ] **Step 5: Add the `analyze` subcommand** (`--prereg <file> --rows <file> [--rows <file2>]`: it concatenates the rows files, so stage 1 and stage 2 rows analyse together) and commit with message `feat(effort-steering): R1 analysis (screen and paired bound)`.

### Task 7: Planted-truth simulation and the bound method

**Files:**
- Create: `effort-steering/spikes/r1/r1-sim.mjs`
- Test: `effort-steering/spikes/r1/r1-sim.test.mjs`

**Interfaces:**
- Consumes: `analyzeR1` (Task 6), `makeRng` (`spikes/s4-prng.mjs`).
- Produces: `simulateR1({ nTasks = 16, runs = 2, pA, trueDelta, trials, seed, method, margin = 0.15, alpha = 0.05 }) -> { supportRate: number, trials: number }`. Per trial it draws a pass probability for A per task (`pA` is an array of per-task probabilities, cycled), sets C's to `clamp(pA_i + trueDelta)`, draws `runs` Bernoulli passes per arm and task, builds rows, and runs the **two-stage decision** (stage 1 rows first; stage 2 rows only when `analyzeR1` says `needs_stage_2`). `supportRate` is the share of trials whose final verdict is `support`.

- [ ] **Step 1: Write the failing tests:** with `pA = [1]` and `trueDelta = 0`, `supportRate === 1`; with `pA = [1]` and `trueDelta = -1`, `supportRate === 0`; the same `seed` gives the same result; a different `method` changes nothing when every task ties.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-sim.test.mjs`.
- [ ] **Step 3: Implement `simulateR1`** and the `sim` subcommand.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Run the planted-truth study** with `pA` set to the S5 arm A pass rate (31 of 32 ≈ 0.97, all tasks), 2000 trials, for `trueDelta ∈ {0, -0.15}` and for both methods (`paired-t`, `percentile` with 4000 resamples). Record the four `supportRate` values. **Rule for the registered method:** pick the method whose `supportRate` at `-0.15` is nearer 0.05 without exceeding 0.06; if both exceed 0.06 or the two differ by under 0.005, take `paired-t` (the S5 default, ruling R76) and tell the operator the numbers. Put the numbers into `README.md` in Task 8.
- [ ] **Step 6: Commit** `r1-sim.mjs`, its test and `r1.mjs`; message `feat(effort-steering): R1 planted-truth simulation of the two-stage decision`.

### Task 8: Registration, stage configs and the gate summary

**Files:**
- Create: `effort-steering/spikes/r1/r1-prereg.mjs`, `effort-steering/spikes/r1/README.md`, and (generated) `effort-steering/spikes/r1/r1-prereg.json`
- Modify: `effort-steering/spikes/r1/r1.mjs` (`prereg`, `stage-config`, `verify-registered`)
- Test: `effort-steering/spikes/r1/r1-prereg.test.mjs`

**Interfaces:**
- Consumes: `loadS5Config` (`spikes/s5/prereg.mjs`), `requireCommitted` (`spikes/s4-prereg.mjs`), `buildR1Root` result (Task 5).
- Produces:
  - `makeR1Prereg({ base, tasks, orderSeed, bound }) -> object` in the S5 prereg shape: `model`, `cli`, `images`, `proxyAllowlist`, `limits` copied from `base` (the object read from `~/work/claude/s5-work/configs/calibrate-batch2.json`; **re-read `images/digests.json` and replace `images` if the digests changed**); `arms` `{ A: { effort: 'xhigh', steer: false, runs: 2 }, B: { effort: 'xhigh', steer: true, runs: 0 }, C: { effort: 'low', steer: false, runs: 2 } }`; `margin: 0.15`; `alpha: 0.05`; `bound` (from Task 7); `orderSeed`; `stopAtCostUsd: 60`; `tasks` from the work root. The writer outputs `JSON.stringify(obj, null, 2) + '\n'` (the loader requires canonical bytes).
  - `stageConfig(prereg, stage: 1 | 2) -> object`: the prereg with `arms.A.runs = 0` for stage 1, `arms.C.runs = 0` for stage 2, everything else equal.
  - `verifyRegistered(file) -> void`: throws unless the file's bytes equal its HEAD blob (`requireCommitted`).

- [ ] **Step 1: Write the failing tests:** `stageConfig(p, 1).arms.A.runs === 0` and all other fields deep-equal `p`; stage 2 likewise for C; `makeR1Prereg` output loads through `loadS5Config(file, { mode: 'calibrate' })` (write it to a temp file) and has `arms.B.runs === 0`; the written text is canonical; `verifyRegistered` throws for an untracked file.
- [ ] **Step 2: Run and see it fail.** `node effort-steering/spikes/r1/r1-prereg.test.mjs`.
- [ ] **Step 3: Implement** the three functions and the three subcommands. `orderSeed`: use `20261013`.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Generate the real registration.** Run the `prereg` subcommand, then `loadS5Config` it, then `checkTasksMatch(prereg, ~/work/claude/s5-work-r1)` (through a `verify` call in the CLI); expected: an empty list (every task matches its manifest).
- [ ] **Step 6: Write `README.md`** with: the runbook (below), the simulation numbers from Task 7, and the four limits the spec's "Limits the report must state" section lists, copied word for word.
  - Stage 1: `node effort-steering/spikes/r1/r1.mjs stage-config --prereg <file> --stage 1 --out ~/work/claude/s5-work-r1/configs/stage1.json`; `node effort-steering/spikes/s5/s5.mjs proxy down`; `proxy up --prereg <stage1.json> --mode calibrate --work-root ~/work/claude/s5-work-r1`; `s5.mjs run --mode calibrate --prereg <stage1.json> --rows ~/work/claude/s5-work-r1/rows-stage1.jsonl --work-root ~/work/claude/s5-work-r1 --stop-at-cost 12`.
  - Stage 2: the same with `--stage 2`, `rows-stage2.jsonl` and `--stop-at-cost 60`.
  - Analysis: `r1.mjs analyze --prereg <r1-prereg.json> --rows rows-stage1.jsonl [--rows rows-stage2.jsonl]`.
  - Flag names are from `spikes/s5/README.md` § 1; **confirm each against `s5.mjs --help` before writing them down.**
- [ ] **Step 7: Run `./tests/run-all.sh`.** Expected: green.
- [ ] **Step 8: Commit** the code, the README and `r1-prereg.json` (the registration, **before stage 1**); message `docs(effort-steering): R1 registration (margin 0.15, 16 trace-prompt tasks)`. Then `r1.mjs verify-registered --prereg effort-steering/spikes/r1/r1-prereg.json` must pass.

### Task 9: Gate — ask the operator

- [ ] **Step 1: Stop.** Report to the operator: the usable task count and any dropped task with its reason, the simulation numbers and the chosen bound method, the registration commit, and the stage 1 plan (about 32 runs, about $6, `--stop-at-cost 12`, model `claude-sonnet-5-5`, arm C `low`). Wait for approval. The S5 proxy container and the pasted OAuth token still need stopping and revoking (spec "Out of scope"); remind the operator.
- [ ] **Step 2 (only after approval): run stage 1**, then `analyze`. If the verdict is `needs_stage_2`, stop again and ask for stage 2 (about 32 runs, about $34). If `support`, stop and report with the limits.
- [ ] **Step 3: Record** the result in ES-22 and ES-23 of `docs/trackers/effort-steering-second-phase.md` and flip the spec's `status`. The operator rules on R1. Push nothing.

## Self-Review

- **Spec coverage:** rule and `when` (Task 1); lab prompt, the `hasStackTrace` check, leak review and the 12-of-16 stop (Tasks 2 to 4); stages 1 and 2, the unit of analysis, the strict bound, the tasks-not-selected rule (Tasks 6 and 8); simulation (Task 7); prereg before stage 1 (Task 8); limits (Task 8 README); gates and no push (Task 9). Open items: the runner takes `prompt.txt`, not `TASK.md` (Verified seams, Task 5); task `CLAUDE.md` is **unchanged**, so its build and test lines stay and `treeHash` and the gates stay valid (Task 5); prereg fields (Task 8); simulation (Task 7).
- **Decision to confirm at the registration review:** the one-line instruction is `'This is the failing test output. Please fix it.'`, and `TASK.md` stays in the tree, so the agent still reads the requirements there. The spec allows only "one line".
- **Type consistency:** `R1_RULES` (Task 1) is used in Task 2; `traceFromTestOutput`, `buildTracePrompt`, `checkTracePrompt` (Task 2) in Task 3; `buildR1Root` result in Task 8; `analyzeR1` in Tasks 7 and 8.
- **Proportion:** each task names signatures, tests and the spec's values; function bodies are left to the implementer.
