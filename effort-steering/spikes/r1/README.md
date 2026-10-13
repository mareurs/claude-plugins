# R1 — does a stack-trace prompt need `xhigh`?  (first effort-routing rule)

Throwaway spike code (ES-10: no `plugin.json`, no marketplace entry). The design is `docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md`, the plan `docs/superpowers/plans/2026-10-13-effort-routing-first-rule.md`. R1 is `hasStackTrace` → `shallow` → effort `low` (`r1-rule.mjs`). It is a **candidate**: `core/rules.json` stays empty until the operator rules on the result.

The experiment reuses the S5 runner unchanged (`spikes/s5/README.md`). Per usable task the prompt is the failing test's output at the parent commit (`RUST_BACKTRACE=1`), then one line: "This is the failing test output. Please fix it." and one build-hint sentence (`TEST_COMMAND_SENTENCE` in `r1-prompt.mjs`): ``Run the tests with `cargo test`; if the build fails to link ONNX Runtime, add `--no-default-features`.`` The sentence is the same text on every task and in every arm, and says nothing about the bug, the files or the cause. Arm C (`low`) runs first (stage 1); arm A (`xhigh`) runs only if C failed somewhere (stage 2).

All commands run from the repository root. `R1="node effort-steering/spikes/r1/r1.mjs"`, `S5="node effort-steering/spikes/s5/s5.mjs"`, `OUT=~/work/claude/s5-work-r1`.

| Module | What |
|---|---|
| `r1-rule.mjs` | the R1 rule entry (confidence `high`: below `high`, `decide.mjs` turns every shallow result into `default`) |
| `r1-prompt.mjs` | trace extraction, prompt building, prompt checks (frames, shallow, `ultrathink`, scrub terms, UTF-8) |
| `r1-stage0.mjs` | f2p output at P in the S5 grade container; the stage 0 report; `--reuse-output` rebuilds the prompts from the saved `f2p.out` files (no Docker) |
| `r1-workroot.mjs` | the second work root: reflink copies of the built tasks with the new `prompt.txt` and `promptHash`; `TASK.md` and `CLAUDE.md` removed and the tree recommitted (new `treeHash` and `baseCommit`, `taskMdHash` null, no `gate.json`) |
| `r1-prereg.mjs` | the registration (S5 prereg shape), the stage configs, the committed-bytes check |
| `r1-analyze.mjs` | the screen and the paired bound |
| `r1-sim.mjs` | planted-truth simulation of the two-stage decision |

## Runbook

1. **Stage 0** (Docker, no model call). `$R1 stage0 --out-root $OUT` writes `$OUT/stage0/<id>.{f2p.out,prompt.txt}` and `report.json`. It exits 1 when fewer than 12 tasks are usable. When only the prompt wrapper changes (the build-hint sentence was added after the first capture and review), do not capture again: `$R1 stage0 --reuse-output --work-root ~/work/claude/s5-work --out-root $OUT` rebuilds the prompts, the report and the hashes from the saved `f2p.out` files. The trace, and so `review.json`, do not depend on the wrapper; the sentence names no bug, file or cause. The trace itself is not byte-stable between captures (parallel tests finish in another order, ids are random), so the saved `f2p.out` and the prompt files are the fixed artifacts, and the registration pins their `promptHash`.
2. **Leak review** (Opus). Write the verdicts to `$OUT/stage0/review.json` as `{ "<id>": "ok" | "leak" | "unfair" }`. Fewer than 12 usable: stop and ask the operator (V2 or V3, spec "Open problem").
3. **Work root.** `$R1 workroot --dst-root $OUT` builds `$OUT/tasks/<id>/` (reflinks, no `TASK.md`, no `CLAUDE.md`, one new commit) and writes `$OUT/workroot-tasks.json`. **Gate every task again, one at a time:** `$S5 gate <id> --work-root $OUT --cpus 4 --memory-gb 8` (no model call; the tree changed, so the copy has no `gate.json`). `treeAtFix` builds the fix tree without the two files because the manifest has `taskMdHash: null`.
4. **Registration.** `$R1 prereg --base ~/work/claude/s5-work/configs/calibrate-batch2.json --tasks-file $OUT/workroot-tasks.json --out effort-steering/spikes/r1/r1-prereg.json`. Check `images` against `spikes/s5/images/digests.json` first. Commit the file, then `$R1 verify-registered --prereg effort-steering/spikes/r1/r1-prereg.json`. **Commit before stage 1.**
5. **Stage 1** (operator gate: 24 runs = 12 tasks × 2 runs of arm C, about $4.5: 24 × $0.19, the S5 per-run figure for `low`).
   ```
   $R1 stage-config --prereg effort-steering/spikes/r1/r1-prereg.json --stage 1 --out $OUT/configs/stage1.json
   $S5 proxy down
   $S5 proxy up --prereg $OUT/configs/stage1.json --mode calibrate --work-root $OUT
   $S5 run --mode calibrate --prereg $OUT/configs/stage1.json --rows $OUT/rows-stage1.jsonl --work-root $OUT --stop-at-cost 12
   $R1 analyze --prereg effort-steering/spikes/r1/r1-prereg.json --rows $OUT/rows-stage1.jsonl
   ```
6. **Stage 2** (operator gate, only when stage 1 says `needs_stage_2`: 24 runs = 12 tasks × 2 runs of arm A, about $25: 24 × $1.05, the S5 per-run figure for `xhigh`). The same with `--stage 2`, `stage2.json`, `rows-stage2.jsonl` and `--stop-at-cost 60`; then `analyze` with both `--rows` files.

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
- The lab prompt is a trace plus one instruction line and one build-hint sentence. Real prompts vary.
- A tie at the ceiling cannot separate the arms. "C passes everything" means "no harm found on these tasks", never "proven safe".
- Run-to-run spread is real; two runs per task are few.
- **The agent finds the test command itself, with one hint.** Spec decision 4: the trace replaces `prompt.txt`, and the agent's tree holds no `TASK.md` and no `CLAUDE.md` (no requirements file, no build or test lines). The only build information is the one sentence in the prompt (operator option A, the conditional wording: the literal `cargo test --no-default-features` was rejected, see the next point).
- **Why the build hint is conditional.** A plain `cargo test --lib` (default features) in the offline container fails to link on `cs-p01`, measured (no model call; files under `s5-work-r1/`: `plainbuild-cs-p01.build.out`, `.build.status`, `.error-lines.txt`, `.result.json`): the build fails after 144 s with ``error: linking with `cc` failed``, `mold: error: undefined symbol: OrtGetApiBase` and ``The ort-sys crate could not link to ONNX Runtime because: ort-sys was instructed not to download prebuilt binaries (`cargo build --offline`), or the `download-binaries` feature is not enabled``. Seven more tasks have `local-embed` in their default features (cs-p05, p06, p08, p10, p11, p12, p19; checked in their `Cargo.toml`, not built here), so the same failure is expected there. The warm target was built with `--no-default-features`, so these 8 tasks pay one rebuild of about 2 to 2.5 minutes before the agent adds the flag. cs-p16 and cs-p17 are graded with `--no-default-features` but their default features hold no `local-embed`: a plain `cargo test` builds (expected, not measured), pays the same rebuild, and runs with `librarian` on while the grader has it off. cs-p18 and cs-p20 are graded with the default features. In both, `librarian` is a default feature and `#[cfg(feature = "librarian")] pub mod librarian;` gates the module, so a sentence that always said `--no-default-features` would hide 2 of the 4 fail-to-pass tests of cs-p18 (`librarian::tools::update_entry::*`; the 2 `tools::edit_file::*` tests are not gated), both of cs-p20 and the `librarian` pass-to-pass tests of both. The conditional wording is true for all 12 tasks. The other 8 tasks (with `local-embed`) and cs-p16, cs-p17 are graded with `--no-default-features`.
- Some library tests read `<crate>/CLAUDE.md` (for example in `src/prompts/mod.rs`). They are in no task's fail-to-pass or pass-to-pass list (all 12 gates pass), but a broad `cargo test --lib` by the agent shows extra failures that point at a missing `CLAUDE.md`.
- The trace names a hidden test file that the agent cannot see; in 5 tasks (cs-p10, p16, p18, p19, p20) its path carries an `s5h_` module that no `mod` line of the tree declares (Opus leak review, 2026-10-13).
- Verdicts: `incomplete` (reason `unmeasured_tasks`) means a registered task has no counted run, or a dropped task has an observed C failure; no claim is made.
