# S5 — does an effort-steering sentence hurt coding quality?

Throwaway spike code (ES-10: no `plugin.json`, no marketplace entry, no README row). S5 runs a coding agent in Docker on real fix-commit tasks in three arms and decides whether the S4 steering sentence ("Answer directly without deliberating.") costs quality. The design is `docs/superpowers/specs/2026-10-07-effort-steering-quality-test-design.md`, the plan `docs/superpowers/plans/2026-10-07-effort-steering-quality-test.md`.

| Arm | Setting | Runs per task (measured) | Runs per task (calibration) |
|---|---|---|---|
| A | `xhigh`, no steer | 3 | 2 |
| B | `xhigh` plus the steer | 3 | 0 |
| C | `low`, no steer | 2 | 1 |

This file has four parts: how the CLI behaves, the **runbook** (the operator gates, with the exact commands), the **instrument rules** (what the code enforces and what a person must do by hand) and, last, what is **not** verified. Every rule names the file or ruling it comes from (`R<n>` is a ruling in the SDD ledger), so a reader can check it.

All commands run from the repository root of the worktree. Below, `S5` stands for

```
S5="node effort-steering/spikes/s5/s5.mjs"
```

## 1. The CLI

`s5.mjs` only wires the existing modules together: argument parsing, the token file, exit codes and printing are its own; everything else is `mine.mjs`, `build-task.mjs`, `gate-task.mjs`, `proxy.mjs`, `prereg.mjs`, `run.mjs`, `analyze.mjs`, `grade.mjs` and `images/build.sh`. `$S5 --help` lists the subcommands; each usage error names the synopsis of the subcommand.

| Subcommand | What it does | Prints on stdout |
|---|---|---|
| `mine --repo <name>=<dir> ... [--since <date>] [--out <file>]` | `mineCommits` over each repo; writes the candidates (default `effort-steering/spikes/s5/tasks/candidates.json`, window default `2026-09-28`) | `{ out, count, perRepo }` |
| `build <taskDir>` | `buildTask` into `<work-root>/tasks/<id>/` | the manifest without `def`: `id, repo, fix, parent, baseCommit, treeHash, hiddenHash, promptHash, taskMdHash` |
| `warm <taskId>` | `warmTask` (cargo tasks only; others answer `skipped: 'not cargo'`) | the result |
| `gate <taskId>` | `gateTask`; writes `<work-root>/tasks/<id>/gate.json` | `{ taskId, ok, reasons, gatedAt, leftover }` |
| `images` | runs `images/build.sh`, forwards its progress to stderr | `images/digests.json` |
| `proxy up (--log-all \| --prereg <file> [--mode <m>])`, `proxy down`, `proxy log` | `proxyUp`, `proxyDown`, `proxyLog` | the result; the log text |
| `run --mode <measure\|pilot\|calibrate\|smoke> --prereg <file> [--tasks <ids>] [--rows <file>] [--concurrency <n>] [--stop-at-cost <usd>] [--retry-exhausted] [--keep-run-dirs] [--open-network] [--token-file <file>]` | `runBatch` | the Summary, once, at the end (nothing is printed while the batch runs: watch the rows file) |
| `grade <runId>` | re-grades a kept run directory | the grade |
| `select --rows <file>` | `selectCalibrated` | `{ kept, dropped }` with a reason per dropped task |
| `analyze --prereg <file> --rows <file>` | `analyzeS5` | the Report |
| `simulate [...]` | the planted-truth simulation | `{ params, scenarios }` |

**Exit codes** (same for every subcommand). `0`: it did what it was asked; for `run` that includes a batch that **stopped by a rule** (cost, signal, `infra_streak`, `hidden_changed`): read `stopped` in the Summary, and for a smoke run `smoke.ok`. `1`: a module threw or refused, a file or manifest could not be read, the token file was refused, or the answer is no (`gate` not ok; `warm` whose build failed). `64`: a malformed command line (usage on stderr, nothing on stdout), as `effort-policy` does. Errors start with `s5: <subcommand>: <message>` on stderr (a module's own message can span several lines).

**Work root.** Every subcommand that touches built tasks takes `--work-root <dir>`, default `~/work/claude/s5-work` (`DEFAULT_WORK_ROOT` in `proxy.mjs`). Never `/tmp`: it is a 24 GB tmpfs. The work root holds `tasks/<id>/{tree,hidden,prompt.txt,manifest.json,gate.json,target}`, `runs/<runId>-a<N>/{config,state[,work,target]}`, `cargo-home/`, `proxy/`, `hook/`, `grades/`, `gate/`, `warm/`, `rows-<mode>.jsonl` and, while a batch runs, `batch.lock`.

**Which loader.** `run --mode measure` loads the file with `loadS5Prereg` (the committed registration: bytes equal to the HEAD blob, at least 8 tasks, A >= 2, B >= 2, C >= 1 runs). `smoke`, `pilot` and `calibrate` load it with `loadS5Config(file, { mode })`: the same shape, no commit needed, an arm may have `runs: 0`, one task is enough. A config is never accepted as a registration, and neither loader accepts a `registered` key in the file (R2, R59). `proxy up --prereg` chooses the loader the same way (`--mode`, default `measure`); `analyze` always uses `loadS5Prereg`.

**The token** (`run` only; no other subcommand reads it; R108). The OAuth token from `claude setup-token` is read from `~/.config/s5/token` (override `--token-file`), unless `CLAUDE_CODE_OAUTH_TOKEN` is already set and not empty in the environment (then the file is not touched, but the **same value check** applies to that value, R145, and the message names the variable; `runBatch` gets the validated value and your own variable is put back untouched afterwards). The CLI **refuses** a file that is a symlink, that is not a regular file (a FIFO is refused, the open does not wait for a writer), that has any group or other permission bit (`mode & 0o077`), that is missing, or that is empty; the message names the path (and the mode) and never a value, and the mode is checked before the bytes are read. All trailing whitespace of the value is dropped (newlines, CRLF, spaces), and a value that still holds whitespace or a control character inside is refused too (R143: a token has none, and a newline in it would fail authentication in every run, looking like infrastructure); the message names the path, never the value. The value is put into the process environment for the duration of `runBatch` only and taken out again; it is never in an argument list, an option, a file or the printed Summary, and everything `run` prints is passed through a redaction of the value as a last line of defence. Create the file without leaving the value in your shell history: see gate 0.

## 2. Runbook

Eight gates; gates 3, 5, 6 and 7 need the operator's approval before anything runs. The counts are from the plan and the spec; the **costs are derived, not measured**: the spec quotes published figures of about $2 to $5 per run at `xhigh` and about $0.8 at `low` ("not our measurement"), and on the subscription the cost is plan usage, not a bill. The multiplication below is mine. The pilot replaces it with the client estimate (`costUsd` in each row, the stdout `total_cost_usd`) and the plan usage the operator reads off the usage page before and after.

| Gate | What | Approval | Runs | Derived cost |
|---|---|---|---|---|
| 0 | token | operator does it | 0 | none |
| 1 | mine | no | 0 | none |
| 2 | pilot tasks | no | 0 (Docker builds and test runs, no model) | none |
| 3 | pilot (smoke first) | **yes** | about 16 (13 + 3 smoke) | $27.2 to $63.2 (12 at `xhigh`, 4 at `low`) |
| 4 | author the rest | no | 0 | none |
| 5 | calibration | **yes** | about 150 | $240 to $540 (100 at `xhigh`, 50 at `low`) |
| 6 | registration | **yes** | 0 | none |
| 7 | measured run | **yes** | about 256 | $435.2 to $1,011.2 (192 at `xhigh`, 64 at `low`) |
| 8 | analyze, rule on G4 | operator rules | 0 | none |

The 13 pilot runs are the proxy control (arm A, two runs on the open bridge network and two through the proxy in log-all mode) and 3 tasks times A, B, C times 1 run; the spec says "about 12". The 3 smoke runs (one per arm, so 2 at `xhigh` and 1 at `low`) are a separate model call and are not in that 13; the table counts them (16 runs: 12 at `xhigh`, 4 at `low`: 12 x $2 + 4 x $0.8 = $27.2, 12 x $5 + 4 x $0.8 = $63.2). The gate 7 figures are 192 x $2 + 64 x $0.8 and 192 x $5 + 64 x $0.8. Calibration is about 50 candidate tasks times (A twice + C once); the measured run is 32 tasks times (3 + 3 + 2).

### Gate 0 — token

```
claude setup-token        # prints the token; the second line is for bash (zsh's `read -p` means something else)
mkdir -p ~/.config/s5 && ( umask 077 && read -rs -p 'token: ' T && printf '%s\n' "$T" > ~/.config/s5/token ) && chmod 600 ~/.config/s5/token
```

The second line asks for the token without echoing it and writes the file with mode 600; `run` refuses any other mode.

### Gate 1 — mine

```
$S5 mine --repo codescout=/home/marius/work/claude/codescout --repo claude-plugins=/home/marius/work/claude/claude-plugins
```

Writes `tasks/candidates.json` (the structural rules of `mine.mjs`: subject starts with `fix`, one parent, authored strictly after `--since`, a test file and a source file changed, at least 2 source files or 40 source lines, nothing under `effort-steering/`, deduplicated by `git patch-id --stable`, at most 4 per subsystem). `mine` reads every ref (`--all`, the default of `mine.mjs`; the CLI has no flag for it) of each checkout through git. Commit the file with an explicit path. `mine` does not filter fixes that change `Cargo.lock`; see the rules.

### Gate 2 — pilot tasks

A Sonnet subagent drafts about 8 task definitions under `effort-steering/spikes/s5/tasks/<id>/` (`task.json`, `TASK.md`, `prompt.txt`, and `extra-tests/` when `task.json` lists `hidden.extra`); an Opus review checks each for leaks and unfair tests. Then, **one command at a time** (rule 12):

```
$S5 images                       # builds s5/codescout, s5/plugins, s5/proxy; prints the image ids (needs the network for base images and apt)
$S5 build effort-steering/spikes/s5/tasks/<id>
$S5 warm <id>                    # cargo tasks: cargo fetch --locked in a container on the default bridge network (it has a route out; so does the proxy, and the pilot's --open-network runs), then a cold build with no network
$S5 gate <id>                    # exit 0 only when ok; the reasons are printed, the detail is in <work-root>/tasks/<id>/gate.json
```

`build` prints the three hashes that go into the config; a built task is never overwritten (remove its directory on purpose first). A gate that is not ok means the task is dropped or rewritten, not that the gate is wrong (reasons: see the header of `gate-task.mjs`).

### Gate 3 — pilot (operator approval)

Prepare two configs (any canonical JSON file outside `/tmp`; `proxyAllowlist` must be non-empty even in log-all mode, so put a placeholder such as `api.anthropic.com` in it for now): `pilot-control.json` with `arms.A.runs: 2`, `B.runs: 0`, `C.runs: 0` and one task; `pilot.json` with runs `1, 1, 1` and 3 tasks. Fill every field from the list in "What the registration holds". Rewrite each file canonical first (rule 2). Every run on the default network goes through the proxy, so the proxy must be up first (`runBatch` refuses a batch whose proxy container is not running, preflight item 5), and the batch also checks the id of the proxy image against the config's `images.proxy` (preflight item 3): that field must be the `s5/proxy` id of `$S5 images`.

Start the proxy in discovery mode, then the smoke (one rep-0 run per arm, on one task; this calls the model):

```
$S5 proxy up --log-all
$S5 run --mode smoke --prereg <work-root>/configs/pilot.json --tasks <id>
```

`smoke.ok` in the Summary must be true: the first user text equals `prompt.txt`, a decision log exists in every arm, B is steered while A and C are not, and no run ended `infra_exhausted` (`run.mjs`, "SMOKE"). A smoke run whose checks fail still exits 0: read `smoke.ok`.

Proxy control. The input size of the **first request** must match exactly between the open-network runs and the proxied runs (the wire recorder doubled it once), and thinking and output must agree within the run-to-run spread:

```
$S5 run --mode pilot --prereg <work-root>/configs/pilot-control.json --tasks <id> --open-network --rows <work-root>/rows-pilot-open.jsonl
$S5 run --mode pilot --prereg <work-root>/configs/pilot-control.json --tasks <id> --rows <work-root>/rows-pilot-proxy.jsonl
$S5 proxy log                    # the hosts Claude Code needed: this is the allowlist
$S5 proxy down
# put those hosts into proxyAllowlist of pilot.json (and of the later configs), re-canonicalise the file (rule 2), then:
$S5 proxy up --prereg <work-root>/configs/pilot.json --mode pilot        # now with the allowlist from the config
$S5 run --mode pilot --prereg <work-root>/configs/pilot.json --keep-run-dirs
```

Two rows files are used for the control because a run id (`<task>.A.0`) is the same in both and a final row makes a run done; `--open-network` is accepted for `--mode pilot` only. The log-all proxy stays up from the first command to `proxy down`, so `proxy log` also shows the hosts of the smoke runs; it is the list of hosts, not a count of requests per arm. Measure and write down: the client cost estimate per run, the plan usage (the operator reads the usage page before and after), the run wall time (it sets the limit T: about 3 times the median A run, with a cap, per the spec), the grade time (`grade.wallMs`) and the disk per run (`du -s` on a kept run directory; `--keep-run-dirs` is what keeps `work/` and `target/`, which `runOne` removes after every run). Check the pilot items in rule 9.

### Gate 4 — author the rest

The same as gate 2 for the remaining candidates of gate 1's file, to about 50 in all; `build`, `warm`, `gate` each (one at a time).

### Gate 5 — calibration (operator approval)

The config has `A.runs: 2`, `B.runs: 0`, `C.runs: 1` and all candidate tasks (calibration has no B arm). Calibration rows are never reused for measurement (spec): they live in their own file.

```
$S5 proxy down                  # the pilot's proxy is still up; proxyUp refuses while a container s5-proxy exists
$S5 proxy up --prereg <work-root>/configs/calibrate.json --mode calibrate
tmux new -s s5-calibrate      # then, inside tmux:
$S5 run --mode calibrate --prereg <work-root>/configs/calibrate.json     # rows: <work-root>/rows-calibrate.jsonl
$S5 select --rows <work-root>/rows-calibrate.jsonl
```

`select` reads calibration rows only (a row of another mode is refused, R142) and applies the drop rule fixed in the spec: `not_measured` (no counted A run or no counted C run), `never_solved` (A passes 0 of its runs), `effort_idle` (A passes every run and C passes every run); the rest are kept. If fewer than 32 tasks are kept, the operator chooses: curate more tasks or accept a wider margin.

### Gate 6 — registration (operator approval)

Write `s5-prereg.json` (canonical form, rule 2) with the kept tasks, then run the simulation for the registered numbers and **attach its output to the commit message**:

```
$S5 simulate --method <bound.method> --resamples <bound.resamples> --seed <bound.seed> --n-tasks <number of tasks> --runs-a <A.runs> --runs-b <B.runs> --runs-c <C.runs> --margin <margin> --alpha <alpha>
```

`simulate` with no options uses the numbers the tests use: 32 tasks, A 3, B 3, C 2, task pass rates uniform on 0.3 to 0.95, 1,000 trials of 1,000 resamples, margin 0.15, alpha 0.05, seed 20261008, method `paired-t`; it prints `niRate` and `gateRate` for two scenarios: `deltaB = -0.15, deltaC = 0` (`niRate` is the false non-inferiority rate and `gateRate` the gate's false-positive rate) and `deltaB = 0, deltaC = -0.3` (`niRate` is the power of the non-inferiority claim and `gateRate` the gate's power). Register `bound.method` as `paired-t` (rule 1). Commit `s5-prereg.json` by explicit path; the measured run refuses it unless its bytes equal the HEAD blob.

### Gate 7 — measured run (operator approval)

```
$S5 proxy down                  # the calibration proxy is still up
$S5 proxy up --prereg effort-steering/spikes/s5/s5-prereg.json
tmux new -s s5-measure        # then, inside tmux:
$S5 run --mode measure --prereg effort-steering/spikes/s5/s5-prereg.json --stop-at-cost <usd>
```

`--stop-at-cost` overrides `stopAtCostUsd` of the registration for this invocation (the rows file is summed, so the stop survives a resume). `--tasks` is refused in measure mode (by `planRunsS5`; the CLI answers exit 1). Resume after a stop by running the same command again: `planRunsS5` is a function of the registration alone, and the rows file says what is done. Watch with `tail -f <work-root>/rows-measure.jsonl`.

### Gate 8 — analyze

```
$S5 analyze --prereg effort-steering/spikes/s5/s5-prereg.json --rows <work-root>/rows-measure.jsonl > report.json
```

The Report is printed as JSON, **with `excluded` in full** (every registered task that has no counted run in some arm, including registered tasks with no rows, with its reason). `mechanism.thinking` keeps its own verdict (it is the registered test); `mechanism.output` and `mechanism.total` are printed as `signedDelta` and `pValue` only, never as a verdict (descriptive, R62). A note on stderr says how many typed lines and lines without a `runId` were skipped. **`analyze` refuses a rows file that holds a row whose `mode` is not `measure`, or that has none** (R142; exit 1, the message names the line and the mode), so pilot or smoke rows can never be counted as measured; `select` does the same for any row whose mode is not `calibrate`. A `type` line is not a row and is not checked. To use rows of another mode **on purpose** (say, to look at a pilot file with `analyze`), copy them into a NEW file with the mode changed, and give that file to the command; the CLI will not do it for you:

```
node -e "const fs=require('fs');for(const l of fs.readFileSync(process.argv[1],'utf8').split('\n'))if(l.trim()){const r=JSON.parse(l);if(!('type' in r))console.log(JSON.stringify({...r,mode:process.argv[2]}))}" <from-rows.jsonl> <new-mode> > <new-file.jsonl>
```

(it drops the `type` lines and rewrites `mode` on the rest; never write over `rows-measure.jsonl` with it). Write the result into ES-22; the operator rules on G4.

### What the registration holds, and where each value comes from

| Field | Source |
|---|---|
| `model` | `claude-sonnet-5-5` |
| `cli.version`, `cli.sha256` | `2.1.292`; `sha256:` and the hex of `sha256sum ~/.local/share/claude/versions/2.1.292` (the batch compares it with the binary it mounts) |
| `arms` | A and B the same `effort` (`xhigh`), B steered; C strictly below A (`low`); `runs` as in the table at the top |
| `tasks[]` | `id`, `treeHash`, `hiddenHash`, `promptHash` from the output of `$S5 build` |
| `margin`, `alpha` | `0.15`, `0.05` |
| `bound` | `method` `paired-t` (rule 1), `resamples`, `seed` |
| `orderSeed`, `mechanism` | chosen once: the arm-order seed; the permutation test's `alpha`, `permutations`, `seed`, `effectSizeThinkingTokens` |
| `limits` | `timeoutMinutes` (1 to 240; from the pilot), `cpus`, `memoryGb`, `concurrency`, `infraRetries` (0 to 5) |
| `images` | the three ids of `$S5 images`, with the keys renamed: `s5/codescout` is `codescout`, `s5/plugins` is `claude-plugins`, `s5/proxy` is `proxy` |
| `proxyAllowlist` | the hosts `proxy log` showed in the pilot |
| `stopAtCostUsd` | the stop rule |

The exact shape and ranges are the header of `prereg.mjs`; a refusal names the field.

## 3. Instrument rules

Short, one per paragraph, each with its source. Where the code enforces a rule, it says so; the rest a person must do.

1. **Register `bound.method` as `paired-t`** (R76; `analyze.mjs` header, `analyze.sim.test.mjs` header). The brief's tie rule would take the percentile bootstrap, but the spec's own criterion (at a true delta of -0.15 non-inferiority is claimed in at most about 5 percent of trials) is met by `paired-t` and not by the percentile bootstrap, which is anti-conservative at N = 32. Over seeds 1 to 40 (40,000 trials per method, 1,000 resamples; re-run for this README on 2026-10-09 and the numbers reproduced): `paired-t` false non-inferiority rate mean 0.0482, max 0.066, 1 of 40 seeds above 0.065; percentile mean 0.0594, max 0.082, 5 of 40 above 0.065. The module default is `paired-t`; both stay selectable by the registration. For `paired-t`, `bound.resamples` may be 0 (it does not resample); the log-ratio intervals still use at least 2,000.
2. **Canonical JSON** (R65; `prereg.mjs`). Both loaders require the file's bytes to equal `JSON.stringify(parsed, null, 2) + '\n'`, so a repeated key or a value such as `0.10` cannot make a committed registration read two ways. The refusal names the file and the rewrite command (a repeated key collapses to its last value, which the commit then shows):
   ```
   node -e "const fs=require('fs'),f=process.argv[1];fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,2)+'\n')" '<file>'
   ```
3. **A config is not a registration** (R2, R59). Only `loadS5Prereg` sets `registered: true`; the file may not carry a `registered` key; `runBatch` refuses `measure` without the marker.
4. **The prompt** (R98, R99, R111, R118; `build-task.mjs`, `run.mjs`). `prompt.txt` is stored beside `manifest.json` (never inside `tree/`) and sent to the CLI **byte for byte** as ONE argument after `--`. `build` refuses a prompt that is not UTF-8 or that holds a NUL byte, and a run refuses a `prompt.txt` whose sha256 is not the manifest's `promptHash`. The check that the transcript's first user message is the prompt (`firstUserTextOk`) compares after `trimEnd()` on both sides: a trailing newline is the one benign difference.
5. **The rows file** (R100, R133, R123; `run.mjs`). JSONL, append-only, one line per **attempt**. A Row has `runId` (`<taskId>.<arm>.<rep>`), `final` and `infra`: an infrastructure attempt that will be re-run has `final: false, infra: <reason>`; the last allowed attempt is written `final: true, infra: 'infra_exhausted'` (+ `lastInfra`); a counted row has `final: true, infra: null`. **A line with a `type` key is not a Row** (the `stopped` line: `{ type: 'stopped', at, reason, costUsd, limit, mode }` and, for `infra_streak`, `streak` and `lastInfra`), and `select`/`analyze` skip it and every line without a `runId`. Every line carries `mode`, and a batch refuses a rows file with a row of another mode: run ids are the same in every mode, so **each mode has its own file** (default `<work-root>/rows-<mode>.jsonl`); `analyze` and `select` refuse a row of the wrong mode too (R142). One batch at a time per work root (`batch.lock`, with the pid, mode and rows file; a lock whose pid is dead is replaced; after a hard kill the refusal names the file to delete if the pid number was reused). Only counted rows enter the analysis (`final` and `infra: null`); a timeout is a counted failure; an exhausted run is never counted, and a task with no counted run in an arm leaves the analysis in all arms and shows in `excluded`.
6. **Task commands** (R30, R53; `task-def.mjs`). `loadTaskDef` refuses a command that breaks these: in a cargo task every `f2p`/`p2p` command starts with `cargo` (no `env`, no `sh -c`) and a `cargo test` carries `--no-fail-fast` before any `--` (the gate cannot see a missing one: every test passes at the fix); in a node task it starts with `node` and runs `node --test --test-reporter=tap <file>`, both options **before** the first positional argument and in `--opt=value` form (on node v26.10.0 `node --test a.test.mjs --test-reporter=tap`, or a plain `node a.test.mjs`, prints spec output that the grader cannot read, and the gate drops the task). The `sh` runner is free.
7. **Fixes that change `Cargo.lock` are dropped** (R47). The grade has no network and the agent no route to the internet, so no agent fix can add a dependency; the gate reports such a task as `fails_at_fix` and `hidden_test_not_run`. The task set is biased away from dependency-adding fixes, and that bias is the cost of the design. This is a ruling, not code: `mine` does not pre-filter it.
8. **An early stop or check-in is judged by hand** (spec "failure modes"). The row keeps only `finalTextTail` (the last 300 characters of the agent's final text) and `testsRunBeforeDone`; read the failed runs' `finalTextTail` to tell a run that stopped to ask from one that finished wrong. Nothing in `analyze` decides it.
9. **What the pilot must confirm** (R88, R108, R139). (a) The stdout field names `total_cost_usd`, `num_turns` and `is_error` of the pinned CLI: if they differ, `costUsd` and `numTurns` are `null` in the rows until the names are fixed. (b) `exit.code` over the pilot's rows: whether 130, 137 or 143 ever occur in a normal run (without a timeout they are classified `interrupted`, infra; a 137 with `timedOut` true is the harness's own timeout kill and stays a final model failure, R90, R132). (c) `tokenScrubbed`: above 0 in any row means the CLI exposed the token to its tools (the files holding it were redacted in place). (d) Stdout that holds no JSON result with exit 0 (R139 b): no rule covers it yet; if the pilot shows one, add `exit 0 with no JSON result = infra no_result`. (e) Whether the CLI honours `HTTPS_PROXY`: the log-all control shows it. (f) The first-request input size (rule in gate 3).
10. **Watch `arm_mismatch` (and `no_log`)** (R89; `run.mjs`, `effort-steering/adapter/claude-code/run-policy.mjs`). The hook gives the policy CLI 500 ms (`POLICY_TIMEOUT_MS`), kills it at the limit and fails open with no steer; under container CPU limits that could leave a B run unsteered (Task 10a's note). `runOne` compares the CLI's decision log with what the arm must have been given (B treated and steered; A and C held out): a missing log is infra `no_log`, a log that differs is infra `arm_mismatch`; both are re-run and never scored. A rate of such rows in the smoke or the pilot is the sign.
11. **Never mount `<work-root>/tasks/<id>/` read-write** (Task 8 carry; `prereg.mjs` `checkTasksMatch`). A run mounts reflink copies of the tree and the target (`work`, `target`); a grade mounts those copies and `hidden/` read-only; `checkTasksMatch` follows a symlink planted in that directory. The one rw mount under `tasks/<id>/` is `warmTask`'s `target/` (a sub-directory, created fresh).
12. **One thing at a time** (R122, R134 c, R123; `run.mjs`). At its start a batch removes every container that carries **both** labels `s5=1` and `s5.task`, whichever work root it belongs to; `warm`, `gate`, `grade` and the Docker-mode test suites (`S5_DOCKER_TESTS=1`) start containers with those labels too. So run **one** batch, gate, warm or Docker-mode suite at a time, and do not start `warm`, `gate` or `grade` while a batch runs. The proxy (`s5=1`, `s5.run=s5-proxy`, no `s5.task`) survives the sweep. About 20 unrelated containers run on this host: only `s5=1` containers are ever touched and nothing is pruned.
13. **`infra_streak`** (R124, R125). When `2 * (1 + limits.infraRetries)` infrastructure attempts follow each other, the batch stops with reason `infra_streak`. Look at Docker, the proxy (`docker ps --filter label=s5=1`) and the disk first, then resume with the same command, adding `--retry-exhausted` if runs were exhausted: a run whose latest final row is `infra_exhausted` is then planned again with a fresh allowance; the exhausted row stays in the file as evidence. An outage is recovered by that act, never by editing the rows file. `interrupted` rows are infrastructure and are re-run.
14. **Run batches under tmux** (R139 c, R141). A closed terminal is then a graceful stop through the SIGHUP handler; do not rely on `nohup`. The **first** Ctrl+C (SIGINT, SIGTERM or SIGHUP) is a graceful stop: nothing new starts and the runs in flight finish, which can take as long as the longest run needs (up to `limits.timeoutMinutes`; the ledger's figure is 90 minutes, plus the run's grade). The **second** signal ends the harness at once and leaves the clients and containers, which the next batch's sweep removes; the paid run in flight has no row. A `gate` or `warm` interrupted by Ctrl+C also leaves its container running (it carries `s5=1` and `s5.task`; the next batch sweeps it).
15. **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is never set** (R108). It would switch off `--dangerously-skip-permissions` and need bubblewrap in the image: a different instrument. Neither this CLI nor `runOne` sets it (nor `GITHUB_ACTIONS`); a value in the operator's environment does not reach the container (the container's variable list is pinned by a test in `run.test.mjs`). To keep the token out of the transcripts anyway, `runOne` redacts it in `config/` and `state/` after every run (`tokenScrubbed` counts the files that held it).
16. **The usage rule** (finding of 2026-10-07; `usage.mjs`). Per `message.id` the record with the **largest** `usage.output_tokens` counts (the last on a tie), never the first: early records of a message carried partial usage in 13 of 596 multi-record messages in this session's tool-loop transcripts. The main transcript and every `subagents/**/agent-*.jsonl` count; an id already counted is not counted twice (a forked subagent repeats its parent's ids).
17. **`grade <runId>` needs a kept run directory.** `runOne` removes `work/` and `target/` after every run, so only a run started with `--keep-run-dirs` can be re-graded; the CLI takes the highest attempt number that still has a `work` directory, prints the grade and writes no rows. The kept `work/` can hold the token if the agent wrote it there (R116 case 1). The re-grade uses the image tag of the task's repo (not the id the run was pinned to) and passes no CPU or memory limit. It starts a container labelled `s5.task`: rule 12 applies.

## 4. Not verified

- **The Docker paths of this CLI have not been run.** The tests inject every module; `images`, `proxy`, `warm`, `gate`, `run` and `grade` have not been run against a Docker daemon through this CLI by the author of this file. The modules they call have their own tests, some of which need `S5_DOCKER_TESTS=1`.
- **The cost figures** in the table are my multiplication of the spec's published per-run figures, not a measurement. The pilot is where they get replaced.
- **The 90-minute figure** for a graceful stop comes from the ledger and the example registration; the real bound is the registered `limits.timeoutMinutes` and the grade time.
- **R139 b** (`claude -p` cut off by SIGINT probably exits 0 on 2.1.292) is a static reading recorded in the ledger; no model call was spent on it.
- **Whether `claude` 2.1.292 honours `HTTPS_PROXY`** and which hosts it needs: only the pilot's log-all control can say.
- **A policy CLI killed after it wrote its decision log but before the steer reached the hook** would show a correct decision in the log (the CLI appends the record before it prints its result: `bin/effort-policy.mjs`). That window is read from the code, not observed; `arm_mismatch` and `no_log` cannot see it.
- The CLI exits `0` for a batch that stopped by a rule or for a smoke run whose checks failed: the exit code does not say how the batch went; read `stopped` and `smoke.ok` in the Summary (R144).
