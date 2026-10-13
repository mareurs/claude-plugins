# R1 — does a stack-trace prompt need `xhigh`?  (first effort-routing rule)

Throwaway spike code (ES-10: no `plugin.json`, no marketplace entry). The design is `docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md`, the plan `docs/superpowers/plans/2026-10-13-effort-routing-first-rule.md`. R1 is `hasStackTrace` → `shallow` → effort `low` (`r1-rule.mjs`). It is a **candidate**: `core/rules.json` stays empty until the operator rules on the result.

The experiment reuses the S5 runner unchanged (`spikes/s5/README.md`). Per usable task the prompt is the failing test's output at the parent commit (`RUST_BACKTRACE=1`) plus one line. Arm C (`low`) runs first (stage 1); arm A (`xhigh`) runs only if C failed somewhere (stage 2).

All commands run from the repository root. `R1="node effort-steering/spikes/r1/r1.mjs"`, `S5="node effort-steering/spikes/s5/s5.mjs"`, `OUT=~/work/claude/s5-work-r1`.

| Module | What |
|---|---|
| `r1-rule.mjs` | the R1 rule entry (confidence `high`: below `high`, `decide.mjs` turns every shallow result into `default`) |
| `r1-prompt.mjs` | trace extraction, prompt building, prompt checks (frames, shallow, `ultrathink`, scrub terms, UTF-8) |
| `r1-stage0.mjs` | f2p output at P in the S5 grade container; the stage 0 report |
| `r1-workroot.mjs` | the second work root: reflink copies of the built tasks with the new `prompt.txt` and `promptHash` |
| `r1-prereg.mjs` | the registration (S5 prereg shape), the stage configs, the committed-bytes check |
| `r1-analyze.mjs` | the screen and the paired bound |
| `r1-sim.mjs` | planted-truth simulation of the two-stage decision |

## Runbook

1. **Stage 0** (Docker, no model call). `$R1 stage0 --out-root $OUT` writes `$OUT/stage0/<id>.{f2p.out,prompt.txt}` and `report.json`. It exits 1 when fewer than 12 tasks are usable.
2. **Leak review** (Opus). Write the verdicts to `$OUT/stage0/review.json` as `{ "<id>": "ok" | "leak" | "unfair" }`. Fewer than 12 usable: stop and ask the operator (V2 or V3, spec "Open problem").
3. **Work root.** `$R1 workroot --dst-root $OUT` builds `$OUT/tasks/<id>/` (reflinks) and writes `$OUT/workroot-tasks.json`.
4. **Registration.** `$R1 prereg --base ~/work/claude/s5-work/configs/calibrate-batch2.json --tasks-file $OUT/workroot-tasks.json --out effort-steering/spikes/r1/r1-prereg.json`. Check `images` against `spikes/s5/images/digests.json` first. Commit the file, then `$R1 verify-registered --prereg effort-steering/spikes/r1/r1-prereg.json`. **Commit before stage 1.**
5. **Stage 1** (operator gate: about 32 runs, about $6).
   ```
   $R1 stage-config --prereg effort-steering/spikes/r1/r1-prereg.json --stage 1 --out $OUT/configs/stage1.json
   $S5 proxy down
   $S5 proxy up --prereg $OUT/configs/stage1.json --mode calibrate --work-root $OUT
   $S5 run --mode calibrate --prereg $OUT/configs/stage1.json --rows $OUT/rows-stage1.jsonl --work-root $OUT --stop-at-cost 12
   $R1 analyze --prereg effort-steering/spikes/r1/r1-prereg.json --rows $OUT/rows-stage1.jsonl
   ```
6. **Stage 2** (operator gate, only when stage 1 says `needs_stage_2`: about 32 runs, about $34). The same with `--stage 2`, `stage2.json`, `rows-stage2.jsonl` and `--stop-at-cost 60`; then `analyze` with both `--rows` files.

Verdicts: `support` (no harm found on these tasks), `needs_stage_2`, `not_shown_safe` (stage 2: the one-sided 95 percent lower bound of the mean `C − A` is not above −0.15; the comparison is strict), `insufficient` (fewer than 2 included tasks), `incomplete` (a registered task is unmeasured). A task with a lost run is dropped from both arms, but a C failure observed in it still counts (`failedC`).

## Planted-truth simulation (2026-10-13)

`$R1 sim --n-tasks 12`: 12 tasks (the registered count), 2 runs, arm A passes with probability 31/32, 2000 trials, seed 20261013, the whole two-stage decision. Support rate:

| bound | true Δ = 0 (power) | true Δ = −0.15 (false support) |
|---|---|---|
| `paired-t` | 0.844 | 0.0685 |
| `percentile` (4000 resamples) | 0.857 | 0.0855 |

Both bounds give a false-support rate above the nominal 0.05 at N = 12 with discrete pass rates. The registration uses `paired-t` (the S5 default, ruling R76; the plan's rule: both exceed 0.06). Read a `support` verdict with that in mind. (For N = 16 the numbers were 0.9285 / 0.0745 and 0.9285 / 0.0755; the registered design has 12 tasks, after the stage 0 checks.)

## Limits the report must state

- Population: Rust fixes from one repository (codescout), with tasks authored by Sonnet and checked by Opus. Results do not carry to other languages, to design questions that paste a trace, or to prompts that are not fixes.
- The lab prompt is a trace plus one line. Real prompts vary.
- A tie at the ceiling cannot separate the arms. "C passes everything" means "no harm found on these tasks", never "proven safe".
- Run-to-run spread is real; two runs per task are few.
- **The agent keeps the full requirements.** The trace replaces only `prompt.txt`. The agent's tree still holds `TASK.md` (the full requirements) and a `CLAUDE.md` that points at it, as in S5. So a pass says nothing about a prompt that is a trace alone, and the lab is easier than the spec's "what a user would paste". Removing both files changes `treeHash` and needs a re-gate of every task: the operator decides before stage 1.
- The trace names a hidden test file that the agent cannot see; in 5 tasks (cs-p10, p16, p18, p19, p20) its path carries an `s5h_` module that no `mod` line of the tree declares (Opus leak review, 2026-10-13).
- Verdicts: `incomplete` (reason `unmeasured_tasks`) means a registered task has no counted run, or a dropped task has an observed C failure; no claim is made.
