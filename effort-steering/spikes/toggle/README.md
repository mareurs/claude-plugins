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
The plan's one-line command (`--low` with three directories after it, `--xhigh` with two) is not accepted by the CLI (exit 64); written with repeated flags it puts every run of v2 and v2r in both groups, and prints `xhigh broad: 7 of 12` and `low broad: 5 of 17`. Those numbers are the mislabelling, not the data.

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

### `switchAt`: 3 (the plan's formula) or 5 (spec C5)

Spec C5, verbatim: "Step 0 switches at request index 5 (before the earliest observed fix at 7). The registration re-derives this from all available `cs-p20` transcripts before step 0 runs."

Measured on all 10 `low` `cs-p20` runs (v2 2, v2r 3, v2p 5): `firstEditIndex` is a real fix edit in every run. Each one patches `mod.rs` (all 10 edit commands name it; the one command seen in full context reaches it as `../tools/mod.rs` from `/work/src/librarian`): 8 with a `python3 - <<'E' ... open(f,'w').write(...)` heredoc, 2 with `sed -i '114a ...'`. None is a `cat >` script and none uses `Edit` or `Write`. The first fix edit falls at requests 5, 5, 6, 6, 6, 7, 7, 7, 7, 8: range 5 to 8, minimum 5. The spec says the earliest observed fix is at 7; these 10 runs give 5.

Two values are on the table:

- **3** comes from the plan's formula `switchAt = max(3, min(firstEditIndex over the low runs) - 2)` = `max(3, 5 - 2)`. `check-known` prints this value.
- **5** is spec C5's value (the earliest `low` fix edit, `min`).

`loadRegistration` checks only that `switchAt` is an integer >= 1 (and that the F-LX and F-XL schedules match it). The value is the operator's choice in the committed `step0-prereg.json`.

What the choice changes. An earlier switch puts more of each F-LX run at `xhigh` and more of each F-XL run at `low`. That favours `delivered` in both directions. It also tests the lever less like the step 1 use case, where the agent switches late, before its final checks. The test stays valid at 3: the observable is `broadAt >= switchAt` (`analyze.mjs`), so a broad check is counted only if it is made after the switch, in either case.

**3 versus 5: open operator decision at G2.**

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

- **stage-config.** Reads a committed registration (`step0-prereg.json` or `step1-prereg.json`, in this directory). Writes the S5 config of one arm: `base` with all S5 arms at `runs: 0` except the arm's `s5Arm`, `tasks` cut to the arm's tasks, `mod` set. `--runs N` replaces ONLY the run count, and N is the TOTAL number of reps per task for that arm, never "N more" (see "Run counts and resuming" below). The output is checked with `loadS5Config(out, { mode: 'calibrate' })`. `--runs` must be at least 1.
- **check-runs.** `--rows` is the rows file `s5 run` appends to (`<workRoot>/rows-<mode>.jsonl`). `--work-root` must hold `runs/`; a root without it is an error (exit 1). `--mode` is the arm's mod mode. `none` is for a run made without a mod (reused R1 V2 rows): no log is expected, so only the `audit` reason and a missing or unreadable transcript (`no_transcript`, `ambiguous_transcript`, `transcript_unreadable`) exclude. Output: a JSON array of `Run` objects (the evidence file). Prints `wrote <out>: <n> runs, <k> excluded`.
- **analyze0 / analyze1.** `--evidence <arm>=<file>` repeats. An arm the registration lacks, a repeated arm and a registered arm with no evidence are usage errors (exit 64). A malformed evidence file exits 1 and names the file and the run. The registration must be of the right step. `analyze1` merges `R-quality` and `R-other` into `R`.
- **random-params.** Takes T's evidence, keeps the runs of one stratum (`quality` = the registration's quality task, `other` = T's other tasks), then prints `{ s, u, n, pUp, pDown, degenerate }`. Run it once per stratum. Into the registration copy only `pUp` and `pDown` (`s`, `u`, `n` and `degenerate` are not registration keys). `mod.random` takes exactly `{ pUp, pDown, seed }`: `pUp` and `pDown` finite numbers in [0, 1], `seed` an integer in [0, 4294967295] that the operator chooses (`spikes/s5/prereg.mjs` `checkMod`, ruling P8). When `degenerate` is true (`pUp` and `pDown` are 0: T had no `xhigh` request, no up-switch, or the denominator `n (1 - s)` is not positive, that is T was always at `xhigh` or had no requests), do not register it: report to the operator.
- **check-known.** Needs at least one of `--low`, `--xhigh`, `--all`. See the section above. The last four output lines are the summary.

Registration facts the operator needs when writing the file:

- Step 0 arms: exactly `F-L`, `F-X`, `F-LX`, `F-XL`. Keys: `step`, `base`, `arms`, `toolTextSha256`, `switchAt`, `n`, `extension`. Each arm `runs === n`, one task, the same task in all four.
- Step 1 arms: `L`, `X`, `T`, `P`, and optionally `R-quality` and `R-other` (both or neither; their parameters come from T's runs, so they are a second registration commit). Keys: `step`, `base`, `arms`, `toolTextSha256`, `verdict: { qualityTask, qualityRuns, otherRuns, costEstimator }`.
- `toolTextSha256` is the sha256 of the mod's tool description:
  `node --input-type=module -e "import { TOOL_TEXT_SHA256 } from './effort-steering/spikes/toggle/registration.mjs'; console.log(TOOL_TEXT_SHA256)"` (at 2c4bd0f it prints `7c891ee28f69d887f28b18e29be438e88642de7072547d214e199d1f0c2295c8`).
- The check does not hardcode task ids. The spec says "`cs-p20` only" for step 0 and "all 12 tasks" for step 1; the operator reads the committed registration against that text.
- `verdict.costEstimator` is `run` or `task`, chosen by the operator in the step 1 registration (ruling P12). Both values are always printed in `detail.cost`.
- A per-arm work root needs a neutral name: bind-mount source paths are visible in `/proc/self/mountinfo`. Do not name a work root after the arm or the mode.

The S5 runner: `node effort-steering/spikes/s5/s5.mjs run --mode <calibrate|pilot|smoke> --prereg <staged config> --work-root <dir> [--tasks <ids>] [--rows <file>] [--concurrency <n>] [--stop-at-cost <usd>]`. The runbook for S5 itself is `effort-steering/spikes/s5/README.md`.

Which `--mode`. G1b uses `smoke` (plan). For G2 to G4 only `calibrate` and `pilot` work with a staged config: both load it with `loadS5Config` (`s5.mjs:185`), which `stage-config` already checked under `calibrate`, and both plan every arm rep on the named tasks (`run.mjs:33-34`). `measure` does not work: it loads through `loadS5Prereg`, needs a committed registration that carries the `registered` marker, and refuses `--tasks` (`run.mjs:31-32`, `93-98`). `smoke` plans ONE task and rep 0 only (`run.mjs:35`, `116`). Use one mode throughout a work root: the rows file is `<workRoot>/rows-<mode>.jsonl` unless `--rows` (`s5.mjs:409`), `check-runs --rows` reads that file, and a batch refuses a rows file that holds rows of another mode (`run.mjs:885-888`).

### Run counts and resuming

Verified in `spikes/s5/run.mjs` (header lines 10-28; batch layer lines 838-891 and 1478-1488). A run is `<task>.<arm>.<rep>`, rep 0-based, within the task and the S5 arm. The plan is a function of the staged config alone. A run that already has a final row in the rows file (`final === true`) is skipped (`skippedFinal`), whatever the batch. So:

- `--runs N` means reps 0 to N-1 per task. Reps that are already final are skipped; only the missing ones run. It is a TOTAL, never "N more".
- `s5 run` without `--tasks` runs every task in the staged config. `--runs 5` without `--tasks` therefore runs 5 reps on EVERY task of the arm. That is a wrong spend unless the arm has one task.
- Resume needs the SAME work root and the SAME rows file (same `--mode`, same `--rows`). A different rows file does not see the earlier rows and runs the reps again.
- Step 1 arm with two run counts (quality task 5, others 2), per arm `<A>`, in one work root: (a) `stage-config --registration <file> --arm <A> --out <f2>` (runs = `otherRuns` = 2), then `s5 run --mode <m> --prereg <f2> --work-root <dir> --tasks <the 11 other ids>`; (b) `stage-config --registration <file> --arm <A> --runs 5 --out <f5>`, then `s5 run --mode <m> --prereg <f5> --work-root <dir> --tasks cs-p20`. Do (b) with `--tasks cs-p20` only.
- A replacement for an excluded run: stage `--runs n+1` (total) with `--tasks` for that task, same work root. The excluded run keeps its final row, so it is not re-run; rep n is the only one missing, so only it runs.
- The step 0 extension: stage `--runs 8` (n 4 + extension 4), not `--runs 4`. Reps 0 to 3 are skipped.
- "Alternating by rep" (step 0, G2): for k = 1 to 4, for each of the four arms in turn, stage `--runs k` and run it in that arm's work root. At k the reps 0 to k-2 are final and skipped; only rep k-1 runs. This follows from the resume rule above; it has not been run live. Run `check-runs` and `analyze0` between reps (see G2).

## The gates

Common to all: model Sonnet 5.5 (`claude-sonnet-5-5`), CLI 2.1.296 (pinned binary `/home/marius/.local/share/claude/versions/2.1.296`), the R1 V2 Docker harness, the personal S5 token.
Each gate STOPS for the operator. Nothing below runs until the operator approves the run count, the model and the cost.

### G1 Smoke. Operator approval required.

- (a) Direct headless calls, no Docker. R1 V2 flags plus `--plugin-dir <hook copy>/mod`. Prompt: "Call set_effort with level xhigh and reason smoke, then reply done." One call each for `toggle`, `placebo`, `schedule`. **3 calls, about $0.1**, Sonnet 5.5, CLI 2.1.296.
  Pass: the tool is listed and called in `toggle` and `placebo`, and absent in `schedule`; the transcript effort of the request after the call is `xhigh` in `toggle` and `low` in `placebo`; the log is at the configured path.
- (b) One Docker run through `s5 run --mode smoke` on a cheap task, in `toggle` mode. **1 run, about $0.2**, Sonnet 5.5, CLI 2.1.296.
  Pass: the mount is there; the log is under `<runDir>/state/effort-toggle/`; no mod file is in the agent's tree; `check-runs` gives no reasons.
  Config for (b): `stage-config` reads only a committed registration, and no registration has a `toggle` arm before G4. So the G1b config has to be written for this gate: a draft step 1 registration (`loadRegistration` requires the arms `L`, `X`, `T`, `P`), committed, whose committed state the operator approves together with the gate. Then `stage-config --arm T --out <file>`. `smoke` plans one task and rep 0, so `--runs` does not matter. No new command is needed.
- G1 must also confirm two assumptions (see Known limits): one `turn.step` line per transcript message id under CLI retries, and a read-only `/opt/es` mount that the engine does not need to write into.
- If the tool is not listed, spec C6's fallback applies (the flag change goes to every arm; the fixed arms then run fresh). Tell the operator before anything else.

### G2 Step 0. Operator approval required.

1. Write `toggle/step0-prereg.json`: base = the R1 V2 stage config's model, CLI, images, limits and the `cs-p20` task entry; arms `F-L`, `F-X`, `F-LX`, `F-XL`; `switchAt` from the check above (3); `n: 4`; `extension: 4`. Commit it.
2. `stage-config` for each arm. Run the four arms, each in its own work root with a neutral name (tasks and cargo home linked read-only from `~/work/claude/s5-work-v2`), alternating by rep: for k = 1 to 4, stage `--runs k` per arm and run it (see "Run counts and resuming": `--runs` is a total, reps are 0-based, a final row is skipped on resume). `--tasks` is not needed: each step 0 arm has one task.
3. `check-runs` per arm (`--mode schedule`), then `analyze0`. Nothing stops a batch by itself. `stop` is printed by `analyze0` after the fact, so run `check-runs` and `analyze0` between reps to apply the stop rule below. `analyze0` needs an evidence file for all four arms, so run it once every arm has at least one checked run.
4. Step 1 proceeds only on `up: delivered`. If the positive control fails, step 0 stops and the operator decides.

**16 runs (4 arms x 4), about $5.5.** Up to 8 more for an extension or replacements, about $3. Sonnet 5.5, CLI 2.1.296.
A stop rule: more than 2 audit-flagged runs in one arm, or more than 2 second-turn runs in one arm, means the batch should stop and the operator be told (`stop` in the `analyze0` verdict). The operator or the session applies it: nothing in `s5 run` reads `stop`. For an extension stage `--runs 8`; for a replacement of an excluded run stage `--runs n+1` (totals, not extras).

### G3 Pilot. Operator approval required.

3 runs of arm T on `cs-p20`. Not measured, not counted. **About $0.5 to $1.8**, Sonnet 5.5, CLI 2.1.296.
Config: as for G1b, no committed registration has a `T` arm yet. The pilot config has to be written for this gate: the draft step 1 registration (committed, approved with the gate) with `stage-config --arm T --runs 3 --out <file>`, then `s5 run --tasks cs-p20` in a work root of its own. The pilot rows are not evidence for G4: do not feed them to `analyze1`.
If no pilot run calls `set_effort`, STOP and report (spec C9). The tool text is not revised without the operator.
The pilot's measured cost replaces the assumed one in the G4 estimate.

### G4 Step 1. Operator approval required.

1. Write and commit `toggle/step1-prereg.json`: arms `L`, `X`, `T`, `P`; `verdict: { qualityTask: 'cs-p20', qualityRuns: 5, otherRuns: 2, costEstimator }`; each arm's `runs` is 2 (`otherRuns`). The operator also chooses whether L and X on the 11 other tasks reuse the R1 V2 rows (no mod, a stated confound, saves about $17; check them with `check-runs --mode none`) or run fresh.
2. Run T and P first, alternating task by task. Per arm, in its own work root and on one rows file: (a) `stage-config --arm <A> --out <f2>`, then `s5 run --mode <m> --prereg <f2> --work-root <dir> --tasks <id>` for each of the 11 other tasks in turn (2 reps each); (b) `stage-config --arm <A> --runs 5 --out <f5>`, then `s5 run --mode <m> --prereg <f5> --work-root <dir> --tasks cs-p20` (5 reps). `--runs 5` without `--tasks` would run 5 reps on every task (a wrong spend). `--runs` is a total per task: see "Run counts and resuming".
3. `check-runs` for T and P, then `random-params --stratum quality` and `--stratum other`. Write the results into the registration as `R-quality` and `R-other`: each arm is `{ s5Arm: 'C', runs, tasks, mod: { mode: 'random', random: { pUp, pDown, seed } } }`, `pUp` and `pDown` copied from the `random-params` output, `seed` chosen by the operator, `R-quality` on `[cs-p20]`, `R-other` on T's other tasks. If `degenerate` is true, do not register: report to the operator. Commit it (a second registration commit) BEFORE any R run. Every arm, `R-quality` and `R-other` included, registers `runs: 2` (`otherRuns`). `R-quality` is on `cs-p20` only, so it needs only step (b); `R-other` is on the other tasks only, so it needs only step (a). The same holds for any L or X arm that is registered on `cs-p20` alone.
4. Run R (stage the two R arms the same way), then L and X.
5. `check-runs` for every arm, then `analyze1`.

**Run counts:** 27 per arm (5 + 11 x 2) for T, P and R = 81 runs, at an assumed $0.25 to $0.60 each, about $20 to $49. Fresh L and X on `cs-p20`: 10 runs, about $3.3. Fresh L and X on the other 11 tasks: 44 runs, about $17 more. **Total about $23 to $70**, to be replaced by the pilot's measured cost before approval. Sonnet 5.5, CLI 2.1.296.

## Known limits

- `broad` separates the levels on `cs-p20` only. 10 of the 24 `low` runs of R1 V2 (over all 12 tasks; the 2 on `cs-p20` have none) contain a broad check, that is 10 of 22 on the other 11 tasks (for example `cargo test --no-default-features`). In step 1 `broad` is reported per run and is not part of "works".
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
- **P4. Step 1 verdict fields.** A step 1 registration carries `verdict = { qualityTask, qualityRuns, otherRuns, costEstimator }` (as amended by P12), checked by `loadRegistration` and passed to `step1Verdict` as `reg`.
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
- **P15. Design checks in `loadRegistration`.** Step 0: `switchAt` an integer >= 1; the S5 arms are F-L on C (`low`), F-X on A (`xhigh`), F-LX on C, F-XL on A; F-LX = `low` x `switchAt` then `xhigh`; F-XL = `xhigh` x `switchAt` then `low`; F-L and F-X one level; `runs === n`; one task, the same in all four. Step 1: every arm `runs === otherRuns` (the quality task's `qualityRuns` are staged operationally with `stage-config --runs` plus `s5 run --tasks`); the quality task in the tasks of L, X, T, P; T and P tasks equal as sets; L and X tasks subsets of T's. In step 1 an arm's `s5Arm` must have a base effort equal to the level the arm starts at (`registration.mjs:208-210`): in the R1 V2 base that is C (`low`) for L, T, P and R, A (`xhigh`) for X.
- **P16. `check-runs --mode none`.** `none` means a run without a mod (reused R1 V2 rows): no log is expected, so only `audit` and a missing or unreadable transcript (`no_transcript`) exclude; unknown modes exit 64.
- **P17. Random arm strata (C10).** Step 1 may carry `R-quality` (the quality task) and `R-other` (T's other tasks), both or neither, each mode `random` on S5 arm C with its own `mod.random`; the bare name `R` is refused. `random-params --stratum quality|other` filters T's evidence; `analyze1` merges the two into `R`. The parameters are committed in a second registration commit before any R run.
- **P18. Evidence validation.** Every `--evidence` file is an array of Run objects with exactly the keys `check-runs` writes, with types, unique `runId`, and `taskId` among the arm's registered tasks; content errors exit 1 naming file and run. A registered arm with no evidence and evidence for an unregistered arm exit 64. `check-runs` refuses a `--work-root` with no `runs/`.
