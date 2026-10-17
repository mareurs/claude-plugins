# Effort toggle: runbook

Spec: `docs/superpowers/specs/2026-10-17-effort-toggle-design.md` (binding). Plan: `docs/superpowers/plans/2026-10-17-effort-toggle.md`.

Question: can the agent steer its own reasoning effort between `low` and `xhigh` with a tool (`set_effort`), and does that pay?
Step 0 asks whether a forced mid-turn switch changes behaviour at all. Step 1 asks whether the agent steers well.

Everything in this directory is offline. No file here calls a model, starts Docker or runs `s5 run`.
The model calls happen only at the gates below, and each gate needs the operator's approval first.

All commands run from the repository root of the worktree. Run the tests with a `TMPDIR` outside `/tmp` and outside any git repo:

```
TMPDIR=/home/marius/.cache/sdd-effort-toggle-tmp node --test effort-steering/spikes/s5/*.test.mjs effort-steering/spikes/r1/*.test.mjs effort-steering/core/*.test.mjs effort-steering/spikes/toggle/*.test.mjs
```

## What each file does

| file | role |
|---|---|
| `mod/.claude-plugin/plugin.json`, `mod/hooks/hooks.json`, `mod/hooks/register.ts` | The `effort-toggle` mod. Registers the tool `set_effort` (the model sees `mcp__effort-toggle__set_effort`). Modes `toggle`, `placebo`, `random`, `schedule`. Writes a JSONL log (`step`, `call`, `invalid`, `error` lines). Exports `TOOL_DESCRIPTION`. |
| `mod.test.mjs` | Tests of the mod's logic (mode selection, schedules, the random draw, identical tool and result text). |
| `registration.mjs` | The registration format and its loader (`loadRegistration`), the staging of one S5 config per arm (`stageArmConfig`), `TOOL_TEXT_SHA256`, `ARM_MODES`. Refuses a registration that is not committed and unchanged. |
| `commands.mjs` | Shell classifiers: `isBroadCheck` (the step 0 observable) and `auditHits` (the blinding audit). |
| `commands.test.mjs` | Tests of the classifiers (heredocs, quoted `\|` and `&&`, `cd /work &&`, subshells, parent-rooted reads). |
| `evidence.mjs` | What one run's transcript and mod log say: main requests, `firstEditIndex`, second user turn, `checkRun` (log against transcript, audit). |
| `evidence.test.mjs` | Tests of the evidence functions. |
| `analyze.mjs` | The pre-registered decision rules: `step0Verdict`, `step1Verdict`, `randomParams`. Pure. |
| `analyze.test.mjs` | Tests of the decision rules. |
| `toggle.mjs` | The CLI (below). |
| `toggle.test.mjs` | Tests of the CLI and of the registration checks. |

Outside this directory: `spikes/s5/prereg.mjs` accepts a `mod` key in a config, `spikes/s5/hook-copy.mjs` copies the mod into the read-only mount, `spikes/s5/run.mjs` loads it with `--plugin-dir` and guards the efforts a mode can set.
A config with no `mod` key gives the exact R1 V2 command (spec C6).

## The check on the known transcripts (Task 9; no model call)

Purpose: before anything is registered, the matcher (`broad`) and the audit must classify the R1 transcripts the way the spec says.
Every `xhigh` `cs-p20` run must be broad. Every `low` `cs-p20` run must be not broad. The audit must flag none of them.
`s5-work-v2g` is left out: its gate made the agents run broad checks.

How the flags work. Each of `--low`, `--xhigh`, `--all` takes ONE directory; repeat the flag for more.
`--low D` and `--xhigh D` put every run of `D` in that group, whatever its arm letter.
`--all D` classifies by the arm letter of `<task>.<arm>.<rep>-a<N>`: `A` is `xhigh`, `C` is `low`, any other letter is skipped.
The three roots hold both arms (v2, v2r) or `C` only (v2p), so `--all` is the right flag for them.
The plan's one-line command (`--low` with three directories after it, `--xhigh` with two) is not accepted by the CLI (exit 64); written with repeated flags it would label the `C` runs of v2 and v2r as `xhigh` and the `A` runs as `low`.

Command (run 2026-10-18 at commit 2c4bd0f, exit 0):

```
node effort-steering/spikes/toggle/toggle.mjs check-known --task cs-p20 --all ~/work/claude/s5-work-v2/runs --all ~/work/claude/s5-work-v2r/runs --all ~/work/claude/s5-work-v2p/runs
```

Output:

```
cs-p20.A.0-a1 group=xhigh broad=true audit=0 firstEditIndex=10
cs-p20.A.1-a1 group=xhigh broad=true audit=0 firstEditIndex=8
cs-p20.C.0-a1 group=low broad=false audit=0 firstEditIndex=6
cs-p20.C.1-a1 group=low broad=false audit=0 firstEditIndex=5
cs-p20.A.0-a1 group=xhigh broad=true audit=0 firstEditIndex=8
cs-p20.A.1-a1 group=xhigh broad=true audit=0 firstEditIndex=6
cs-p20.A.2-a1 group=xhigh broad=true audit=0 firstEditIndex=7
cs-p20.C.0-a1 group=low broad=false audit=0 firstEditIndex=5
cs-p20.C.1-a1 group=low broad=false audit=0 firstEditIndex=6
cs-p20.C.2-a1 group=low broad=false audit=0 firstEditIndex=7
cs-p20.C.0-a1 group=low broad=false audit=0 firstEditIndex=8
cs-p20.C.1-a1 group=low broad=false audit=0 firstEditIndex=6
cs-p20.C.2-a1 group=low broad=false audit=0 firstEditIndex=7
cs-p20.C.3-a1 group=low broad=false audit=0 firstEditIndex=7
cs-p20.C.4-a1 group=low broad=false audit=0 firstEditIndex=7
xhigh broad: 5 of 5
low broad: 0 of 10
audit hits: 0
switchAt: 3
```

The first four lines are v2, the next six v2r, the last five v2p (the CLI prints the directory name, not the root).
Per root: v2 `xhigh broad: 2 of 2`, `low broad: 0 of 2`; v2r `3 of 3`, `0 of 3`; v2p (`C` only) `low broad: 0 of 5`. `audit hits: 0` in every case.

Reading: every expectation holds (`xhigh broad: n of n`, `low broad: 0 of n`, `audit hits: 0`). The matcher and the audit are consistent with the R1 data.

### `switchAt` is 3, not the spec's 5

Spec C5 says "switch at request index 5, re-derived by the registration". The registration derives it from the data: `switchAt = max(3, min(firstEditIndex over the low runs) - 2)`. The `low` runs' first edit is at request 5 and 6 (v2: 6 and 5), so the value is `max(3, 5 - 2) = 3`.
Cause: `firstEditIndex` counts ANY first write (an `Edit`, `Write`, `MultiEdit`, `sed -i`, `cat >`, `tee`, a heredoc that calls `.write(`), including a patch script written with `cat >`, not only the fix. So the derived switch point is early. That is conservative for the up-switch test: at request 3 the agent has not yet run its final checks.
The operator sees the value at G2, in `step0-prereg.json` (`switchAt`), and decides there.

## Commands

`toggle.mjs <command> [flags]`; usage errors exit 64, a refusal or a failure exits 1, verdicts go to stdout as JSON. Run with no command for the list. Flags repeat only where marked.
Shorthand: `T=effort-steering/spikes/toggle/toggle.mjs`.

| stage | command |
|---|---|
| 1. stage a config | `node $T stage-config --registration <file> --arm <name> --out <file> [--runs <n>]` |
| 2. check runs | `node $T check-runs --work-root <dir> --rows <file> --mode <toggle\|placebo\|random\|schedule\|none> --out <file>` |
| 3. step 0 verdict | `node $T analyze0 --registration <file> --evidence F-L=<file> --evidence F-X=<file> --evidence F-LX=<file> --evidence F-XL=<file>` |
| 4. random parameters | `node $T random-params --registration <file> --stratum <quality\|other> --evidence <T evidence file>` |
| 5. step 1 verdict | `node $T analyze1 --registration <file> --evidence L=<file> --evidence X=<file> --evidence T=<file> --evidence P=<file> [--evidence R-quality=<file> --evidence R-other=<file>]` |
| instrument check | `node $T check-known [--low <runsDir>]... [--xhigh <runsDir>]... [--all <runsDir>]... [--task <id>]` |

- **stage-config.** Reads a committed registration (`step0-prereg.json` or `step1-prereg.json`, in this directory). Writes the S5 config of one arm: `base` with all S5 arms at `runs: 0` except the arm's `s5Arm`, `tasks` cut to the arm's tasks, `mod` set. `--runs` replaces ONLY the run count (an extension or a replacement batch). The output is checked with `loadS5Config(out, { mode: 'calibrate' })`. `--runs` must be at least 1.
- **check-runs.** `--rows` is the rows file `s5 run` appends to (`<workRoot>/rows-<mode>.jsonl`). `--work-root` must hold `runs/`; a root without it is an error (exit 1). `--mode` is the arm's mod mode. `none` is for a run made without a mod (reused R1 V2 rows): no log is expected and only the `audit` reason excludes. Output: a JSON array of `Run` objects (the evidence file). Prints `wrote <out>: <n> runs, <k> excluded`.
- **analyze0 / analyze1.** `--evidence <arm>=<file>` repeats. An arm the registration lacks, a repeated arm and a registered arm with no evidence are usage errors (exit 64). A malformed evidence file exits 1 and names the file and the run. The registration must be of the right step. `analyze1` merges `R-quality` and `R-other` into `R`.
- **random-params.** Takes T's evidence, keeps the runs of one stratum (`quality` = the registration's quality task, `other` = T's other tasks), then prints `{ s, u, n, pUp, pDown, degenerate }`. Run it once per stratum.
- **check-known.** Needs at least one of `--low`, `--xhigh`, `--all`. See the section above. The last four output lines are the summary.

Registration facts the operator needs when writing the file:

- Step 0 arms: exactly `F-L`, `F-X`, `F-LX`, `F-XL`. Keys: `step`, `base`, `arms`, `toolTextSha256`, `switchAt`, `n`, `extension`. Each arm `runs === n`, one task, the same task in all four.
- Step 1 arms: `L`, `X`, `T`, `P`, and optionally `R-quality` and `R-other` (both or neither; their parameters come from T's runs, so they are a second registration commit). Keys: `step`, `base`, `arms`, `toolTextSha256`, `verdict: { qualityTask, qualityRuns, otherRuns, costEstimator }`.
- `toolTextSha256` is the sha256 of the mod's tool description:
  `node --input-type=module -e "import { TOOL_TEXT_SHA256 } from './effort-steering/spikes/toggle/registration.mjs'; console.log(TOOL_TEXT_SHA256)"` (at 2c4bd0f it prints `7c891ee28f69d887f28b18e29be438e88642de7072547d214e199d1f0c2295c8`).
- The check does not hardcode task ids. The spec says "`cs-p20` only" for step 0 and "all 12 tasks" for step 1; the operator reads the committed registration against that text.
- `verdict.costEstimator` is `run` or `task`, chosen by the operator in the step 1 registration (ruling P12). Both values are always printed in `detail.cost`.
- A per-arm work root needs a neutral name: bind-mount source paths are visible in `/proc/self/mountinfo`. Do not name a work root after the arm or the mode.

The S5 runner: `node effort-steering/spikes/s5/s5.mjs run --mode <measure|pilot|calibrate|smoke> --prereg <staged config> --work-root <dir> [--tasks <ids>] [--rows <file>] [--concurrency <n>] [--stop-at-cost <usd>]`. The plan names `smoke` for G1b and no mode for G2 to G4; `stage-config` validates a staged config under `calibrate`. The operator names the mode at approval. The runbook for S5 itself is `effort-steering/spikes/s5/README.md`.

## The gates

Common to all: model Sonnet 5.5 (`claude-sonnet-5-5`), CLI 2.1.296 (pinned binary `/home/marius/.local/share/claude/versions/2.1.296`), the R1 V2 Docker harness, the personal S5 token.
Each gate STOPS for the operator. Nothing below runs until the operator approves the run count, the model and the cost.

### G1 Smoke. Operator approval required.

- (a) Direct headless calls, no Docker. R1 V2 flags plus `--plugin-dir <hook copy>/mod`. Prompt: "Call set_effort with level xhigh and reason smoke, then reply done." One call each for `toggle`, `placebo`, `schedule`. **3 calls, about $0.1**, Sonnet 5.5, CLI 2.1.296.
  Pass: the tool is listed and called in `toggle` and `placebo`, and absent in `schedule`; the transcript effort of the request after the call is `xhigh` in `toggle` and `low` in `placebo`; the log is at the configured path.
- (b) One Docker run through `s5 run --mode smoke` on a cheap task, in `toggle` mode. **1 run, about $0.2**, Sonnet 5.5, CLI 2.1.296.
  Pass: the mount is there; the log is under `<runDir>/state/effort-toggle/`; no mod file is in the agent's tree; `check-runs` gives no reasons.
- G1 must also confirm two assumptions (see Known limits): one `turn.step` line per transcript message id under CLI retries, and a read-only `/opt/es` mount that the engine does not need to write into.
- If the tool is not listed, spec C6's fallback applies (the flag change goes to every arm; the fixed arms then run fresh). Tell the operator before anything else.

### G2 Step 0. Operator approval required.

1. Write `toggle/step0-prereg.json`: base = the R1 V2 stage config's model, CLI, images, limits and the `cs-p20` task entry; arms `F-L`, `F-X`, `F-LX`, `F-XL`; `switchAt` from the check above (3); `n: 4`; `extension: 4`. Commit it.
2. `stage-config` for each arm. Run the four arms, each in its own work root with a neutral name (tasks and cargo home linked read-only from `~/work/claude/s5-work-v2`), alternating by rep. Check how the runner numbers reps across batches before the first run.
3. `check-runs` per arm (`--mode schedule`), then `analyze0`.
4. Step 1 proceeds only on `up: delivered`. If the positive control fails, step 0 stops and the operator decides.

**16 runs (4 arms x 4), about $5.5.** Up to 8 more for an extension or replacements, about $3. Sonnet 5.5, CLI 2.1.296.
A stop rule: more than 2 audit-flagged runs in one arm, or more than 2 second-turn runs in one arm, stops the batch (`stop` in the verdict).

### G3 Pilot. Operator approval required.

3 runs of arm T on `cs-p20`. Not measured, not counted. **About $0.5 to $1.8**, Sonnet 5.5, CLI 2.1.296.
If no pilot run calls `set_effort`, STOP and report (spec C9). The tool text is not revised without the operator.
The pilot's measured cost replaces the assumed one in the G4 estimate.

### G4 Step 1. Operator approval required.

1. Write and commit `toggle/step1-prereg.json`: arms `L`, `X`, `T`, `P`; `cs-p20` 5 runs, the other 11 tasks 2 runs (`otherRuns`; the quality task's extra runs come from `stage-config --runs`); `verdict.costEstimator`. The operator also chooses whether L and X on the 11 other tasks reuse the R1 V2 rows (no mod, a stated confound, saves about $17; check them with `check-runs --mode none`) or run fresh.
2. Run T and P first, alternating task by task (`s5 run --tasks <id>` on each arm's work root).
3. `check-runs` for T and P, then `random-params --stratum quality` and `--stratum other`. Write both results into `R-quality` and `R-other` in the registration and commit it (a second registration commit) BEFORE any R run.
4. Run R, then L and X.
5. `check-runs` for every arm, then `analyze1`.

**Run counts:** 27 per arm (5 + 11 x 2) for T, P and R = 81 runs, at an assumed $0.25 to $0.60 each, about $20 to $49. Fresh L and X on `cs-p20`: 10 runs, about $3.3. Fresh L and X on the other 11 tasks: 44 runs, about $17 more. **Total about $23 to $70**, to be replaced by the pilot's measured cost before approval. Sonnet 5.5, CLI 2.1.296.

## Known limits

- `broad` separates the levels on `cs-p20` only. 10 of 24 `low` runs on the other tasks contain a broad check (for example `cargo test --no-default-features`). In step 1 `broad` is reported per run and is not part of "works".
- Sidechain (subagent) tool calls are not audited, and sidechain transcripts in separate files are not read. The spec says "main transcript". The R1 V2 command does not disallow the Agent tool; R1 agents used none.
- The mapping of one mod `turn.step` line to one transcript message id under CLI-internal retries is an assumption. G1 must confirm it. A mismatch shows up as `log_transcript_mismatch`.
- The engine may write `.claude-plugin/types/` into the mod folder at load, while `/opt/es` is a read-only mount in Docker. G1b decides. If it fails, the spec C6 fallback does not apply: report to the operator.
- `$.tool.register` in `session.start` under `claude -p` has not been run. G1 decides. It fails safe (an `error` line and a pass-through).
- The `/tmp` tmpfs quota can make the S5 suites fail with errno -122 (EDQUOT). Run them with a `TMPDIR` outside `/tmp` and outside any git repo.
- Name per-arm work roots neutrally (bind-mount source paths are in `/proc/self/mountinfo`).
- The cost estimator (`run` or `task`) is chosen by the operator in the step 1 registration. The spec says "mean cost per run" (run-weighted), the plan chose task-weighted.
- The registration check does not hardcode task ids: the operator reads the committed registration against the spec ("`cs-p20` only", "all 12 tasks").
- The audit matches names in the whole command text, so `grep -rn "/proc" src/` is a false positive. A false positive costs one replacement run; a false negative would be silent. Not handled: a relative read after `cd` (`cat ../run/config/x`), `sudo`, `xargs`, `pushd`.
- `firstEditIndex` and `broad` are text rules. `cargo test | tee log` counts as an edit; `cargo t`, `bash -c "cargo test"` and nextest are not classified as broad.
- Second-turn detection also counts sidechain, meta and compaction-summary user records. None occurred in V2.
- Reused R1 V2 rows for L and X have no mod and are not an arm (ruling P7).

## Decisions made while building

Controller rulings P1 to P18. The working notes are removed after the build, so this is where they live.

- **P1. Guard split.** Spec C11 asks for a per-mode guard comparing each request's effort with the mod's log. The plan splits it: `run.mjs` checks set membership (`allowedEfforts`), and `checkRun` checks log against transcript, and `check-runs` excludes the run.
- **P2. Step line fields.** In a mod `step` line `before` is the effort the step arrived with, `after` is the effort as sent (equal to `before` when not rewritten); both are null only when the step carried no effort. Subagent steps are logged too, with `request: null`.
- **P3. `requests` is a number.** `checkRun().requests` is the count of main requests.
- **P4. Step 1 verdict fields.** A step 1 registration carries `verdict: { qualityTask, qualityRuns, otherRuns }`, checked by `loadRegistration` and passed to `step1Verdict` (amended by P12).
- **P5. Failed control.** When the positive control fails, `up` and `down` are `inconclusive` and `stop` includes `positive_control_failed`.
- **P6. Random seed chain.** In `random` mode the whole session's chain is seeded with the FIRST turn's `turnId`; a later turn continues it.
- **P7. Fixed arms.** The fixed arms `L`, `X`, `F-L`, `F-X` use mod mode `schedule` with a one-level schedule (spec: "with the mod loaded in schedule mode so the harness matches"). Reused R1 V2 rows have no mod and are not an arm.
- **P8. Seed range.** `mod.random.seed` is an integer in [0, 4294967295]; the mod XORs it with a 32-bit hash, so larger seeds would alias.
- **P9. Audit goes beyond naming.** The spec ("reads or lists") binds over the narrower brief: `find`, `grep -r`/`-R`/`rg`, `ls -R`, `tree`, `du` with an operand `/`, `/run` or `/opt`; `cd` to those; Read/Grep/Glob `path` equal to one; and `..` segments are resolved before the `/work/` exemption.
- **P10. `excludedFor`.** `excludedFor` is `audit` when `audit` is among the reasons (`checkRun` lists it last), else the first reason, else null; step 0 counts audit exclusions by `excludedFor === 'audit'`, so a run with two reasons still counts toward "more than 2 flagged".
- **P11. Step 1 completeness.** The union of tasks over L, X, T, P is taken; an arm with no counted run on a task adds `<arm>:<task>` to `incomplete`; a task with no finite cost adds `<arm>:<task>:cost`; `works` is null when `incomplete` is non-empty. A short cell still gives a verdict and is listed in `detail.short`.
- **P12. Cost estimator.** The spec says run-weighted, the plan task-weighted, so the estimator is a registration field `verdict.costEstimator: 'run' | 'task'`, required for step 1; both values are always reported.
- **P13. Random parameters input.** `random-params` passes `randomParams` only counted runs (`pass` not null, `excludedFor` null) whose `shareXhigh`, `upSwitches` and `requests` are finite.
- **P14. Registered tasks.** `analyze1` requires counted T evidence for every task in `arms.T.tasks`; a missing one adds `registered-task-missing:<task>` to `incomplete` and forces `works` to null. `step1Verdict` itself stays data-only.
- **P15. Design checks in `loadRegistration`.** Step 0: `switchAt` an integer >= 1; F-LX = `low` x `switchAt` then `xhigh` on S5 arm C; F-XL = `xhigh` x `switchAt` then `low` on A; F-L and F-X one level; `runs === n`; one task, the same in all four. Step 1: every arm `runs === otherRuns`; the quality task in the tasks of L, X, T, P; T and P tasks equal as sets; L and X tasks subsets of T's.
- **P16. `check-runs --mode none`.** `none` means a run without a mod (reused R1 V2 rows): no log is expected, only `audit` excludes; unknown modes exit 64.
- **P17. Random arm strata (C10).** Step 1 may carry `R-quality` (the quality task) and `R-other` (T's other tasks), both or neither, each mode `random` on S5 arm C with its own `mod.random`; the bare name `R` is refused. `random-params --stratum quality|other` filters T's evidence; `analyze1` merges the two into `R`. The parameters are committed in a second registration commit before any R run.
- **P18. Evidence validation.** Every `--evidence` file is an array of Run objects with exactly the keys `check-runs` writes, with types, unique `runId`, and `taskId` among the arm's registered tasks; content errors exit 1 naming file and run. A registered arm with no evidence and evidence for an unregistered arm exit 64. `check-runs` refuses a `--work-root` with no `runs/`.
