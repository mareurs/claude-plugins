---
id: fc50071781001cd0
kind: spec
status: draft
title: 'Effort routing — first rule R1 (stack trace to shallow to low): headroom screen and paired check — design'
tags:
- effort-steering
- effort-routing
- s5
- design
topic: effort routing first rule
---

## Purpose

The effort-steering plugin has a rules engine (`effort-steering/core/decide.mjs`) and no rules: the shipped `core/rules.json` is `{"version":1,"rules":[]}`. ES-9 says a rule needs evidence. This design produces the evidence for one first rule, R1, and ends in a ship or no-ship answer for it. It follows the S5 quality test (spec `2026-10-07-effort-steering-quality-test-design.md`), whose verdict was "uninformative".

## What S5 showed (verified 2026-10-13; see the S5 spec section "Result to date")

- On 16 well-specified fix tasks from real codescout commits, arm C (`low`) passed 16 of 16 and arm A (`xhigh`) 31 of 32 (the one failure was a grader defect). A 5-variant thin-spec probe added 5 of 5 for each arm.
- Per run, `low` cost about $0.19 and `xhigh` about $1.05 (an 82 percent cut). The steer sentence cut cost by about 17 percent in a 3-task pilot.
- No task separated the arms, so S5 could not test harm. The unknown that matters for a rule is the false-shallow case: a hard prompt that the rule maps to `low`.

## Operator decisions (2026-10-13)

1. The next experiment feeds the effort-routing decision (ES-23), not the text-steer verdict (G4). The steer becomes a secondary arm in a later experiment.
2. The experiment produces one candidate rule with a ship or no-ship answer, not a dataset.
3. R1 and the trace-style lab prompt (sections "The rule" and "The lab prompt") are approved. The stages and decision rule (section "Stages and decision rule") are approved. The false-shallow budget stays at 0.15.
4. (After the implementation check, 2026-10-13.) The agent's tree holds **no** `TASK.md` and **no** `CLAUDE.md` pointer to it. The prompt is the trace plus one line and nothing else. The first implementation kept both files, which made the lab easier than S5 and would have made a `support` verdict misleading. Removing them changes every `treeHash`, so each task is re-gated and the registration is redone before stage 1.
5. (After stage 1 under V1, 2026-10-13.) Switch to **V2**: the agent's tree holds the hidden test files, and the grader restores the original copy when it grades. **Fact:** under V1, 10 of 24 arm-C runs made no edit and asked for the test file or its branch, because the trace names a hidden test that is absent from the tree. C passed 4 of 24; the real cost was $1.9045; `analyze` said `needs_stage_2`. A stage 2 had been started and was stopped by the operator after about 4 minutes. The stop was a hard stop (two signals reached the runner), so the one run in flight, cs-p01.A.1, was lost without a row: `rows-stage2.jsonl` was never created, and its cost was not recorded (upper estimate about $1 by the S5 per-run figure). **Meaning:** the V1 result is a validity defect of the lab (the open problem of section "The lab prompt"), not a statement about `low`. **Disclosure:** V2 is chosen after the V1 outcome was seen. The reason is the validity defect (the agent cannot run the test), not the direction of C's score. `rows-stage1.jsonl` stays as a pilot and does not enter the verdict. The V2 analysis uses new rows in new files, a new registration, and a separate operator gate for stage 1 (run count, model, cost). **Design:** `buildR1Root` runs the grader's own `graftScript` on the fresh copy before the one-commit recommit, so the visible tree is byte-identical to what the grader would graft onto an untouched tree, and the grader's graft on it changes nothing. The grader already removes each hidden path and copies the original in, and appends a `graftLines` line only when the module is not declared; so an agent edit of a hidden file has no effect on the grade. The prompt stays the trace plus the build sentence. Still no `TASK.md` and no `CLAUDE.md`. **Gates:** an Opus review of the now-visible test files for fix leaks (symbols, new function names, comments that name the cause) and of the grader path for a bypass (the cs-p19 shadow defect); the floor of 12 tasks stays, and a leak review that leaves fewer stops the work for the operator. **Review result (Opus, same day):** 4 of 12 trees leaked the fix (cs-p01, p06, p08, p16: fix-commit tests and comments in test files that exist at P), so 8 were usable on their own. The repair keeps all 12: for cs-p01, p06 and p08 the hidden copy becomes the P file (every graded name in the file exists at P, checked), and for cs-p16 a doc comment that states the cause is dropped; both are in the committed `r1-v2-adjust.json`, applied by `buildR1Root`. The review also showed that the grader's `graftScript` lets an agent shadow a hidden module (cs-p18, p19, p20; cs-p16 through its parent `mod tests;`) and have the test names reported ok. The operator chose a guard in the grader: `shadowGuardScript` fails the graft step, closed, when the agent's diff adds `#[path]`, a `[[test]]` table or `autotests`, declares a graftLines module in any form but the graftLines line or its rustfmt form, changes the parent's `mod STEM` line above a hidden file, or cannot be read. The V1 rows also undercounted cs-p01 and cs-p12 (their tests need the phrases `keys omitted` / `entries omitted`, never shown under V1).

## The rule

**R1:** if `hasStackTrace` is true, the level is `shallow`; `shallow` maps to effort `low`. The entry uses the existing `rules.json` schema (id, level, confidence, reason, `when`); the plan defines the exact `when` and the confidence.

- An explicit `ultrathink` needs no clause: `decide.mjs` lines 169 to 170 return `deep` before any rule is read.
- `hasStackTrace` is `PY_TRACEBACK.test(text) || NODE_FRAME.test(text)` (`core/features.mjs`). Verified by running `extractFeatures`: a Rust panic message alone gives `false`; a panic followed by a backtrace (`at ./src/lib.rs:34:9` lines) gives `true`; a Python traceback gives `true`.
- The rule fires on any prompt with a trace, including design questions and Python or Node traces. The lab covers only Rust fix prompts (see "Limits the report must state").

## The lab prompt

Per task, the prompt is what a user would paste: the failing test's output at the parent commit with `RUST_BACKTRACE=1`, plus one line ("fix this"). **The agent's tree contains no `TASK.md` and no `CLAUDE.md` that points at it** (decision 4). The agent finds the test command itself, as a user's session would. The plan produces it by running the task's f2p command at P in the existing gate container. No model call is needed. The check `extractFeatures(prompt).hasStackTrace === true` must hold for every prompt used.

**Open problem.** A trace of a hidden test shows the test's name, path and assertion text, and points at a file that is absent from the agent's tree. Three handlings:

- **V1:** use the raw trace. Cheap, but unrealistic and leaky.
- **V2:** put the failing test in the agent's tree and let the grader restore the hidden copy. Faithful, but it changes the grader (the cs-p19 shadow defect shows the risk) and needs an Opus review.
- **V3:** use a trace from product code. This exists only for crash-type bugs and leaves fewer tasks.

Stage 0 builds V1 first and reviews each prompt for leaks. V2 is built only if that review says V1 is unfair. **Result (decision 5):** the leak review passed V1, but stage 1 under V1 showed the defect in practice (10 of 24 runs asked for the test file), so the lab moves to V2.

## Stages and decision rule

Each stage that calls the model is a separate operator gate with a stated run count, model and cost.

| Stage | What | Model calls | Cost (estimate) |
|---|---|---|---|
| 0 | Build the trace prompts for the 16 built tasks (V1). Check that `hasStackTrace` fires. Review each for leaks. Stop if fewer than 12 of 16 tasks are usable. | none | none |
| 1 | Screen: arm C, 2 runs per usable task. | about 32 | about $6 |
| 2 | Only if C fails somewhere: arm A, 2 runs per usable task. | about 32 | about $34 |

The unit of analysis is the task. Per task, d = mean pass of C minus mean pass of A.

- **C passes every usable task:** R1 has support on this population. The report states the limits below. The ship decision is the operator's.
- **C fails on some task:** stage 2 runs. R1 passes if the one-sided 95 percent lower bound of the mean d is above −0.15. Otherwise R1 is not shown safe for fix prompts.
- The budget 0.15 is the S5 margin. A rule that is on by default could deserve a stricter budget; the operator may change it before the registration.
- Run order within a task is randomised from a registered seed. The registration (a prereg file) is committed **before stage 1**, as in S5. The stage-1 C runs are the measured C runs and are not repeated in stage 2. Stage 2 runs A on every usable task, never only on the tasks where C failed, so the screen does not select the tasks.

**Power (computed 2026-10-13, plain bootstrap, 16 tasks, indicative only).** All tasks tied: lower bound 0. One task with C 0 of 2 and A 2 of 2: −0.188 (fails the margin). One task with C 1 of 2 and A 2 of 2: −0.094 (passes). Two such half-failures: −0.125 (passes). A single total failure sinks the claim at N = 16. The plan runs the S5-style planted-truth simulation before stage 1 and may replace the plain bootstrap with an exact method.

## Limits the report must state

- Population: Rust fixes from one repository (codescout), with tasks authored by Sonnet and checked by Opus. Results do not carry to other languages, to design questions that paste a trace, or to prompts that are not fixes.
- The lab prompt is a trace plus one line. Real prompts vary.
- A tie at the ceiling cannot separate the arms. "C passes everything" means "no harm found on these tasks", never "proven safe".
- Run-to-run spread is real; two runs per task are few.

## Risks

- **V1 leaks hidden-test content.** The Stage 0 review decides; a leak invalidates the prompts, not the arms.
- **The trace prompt is easier, not harder.** A trace gives exact expected and actual values. Stage 1 may then show no headroom again. That is a result (R1 has support on the population), but it does not probe hard cases.
- **No C failure appears.** The cheap screen then ends the experiment at about $6. Harder tasks remain the open problem for any rule beyond fix-with-trace prompts.
- **Small-N bootstrap.** See "Power".
- **Plan limit.** The runs use the personal-account token; the runner's `plan_limit` stop is the guard.

## Process and gates

1. The operator reviews this spec; then the implementation plan (writing-plans); the operator chooses the execution method.
2. Stage 0 (no model call) and its leak review.
3. Registration: the prereg file (tasks and prompt hashes, margin 0.15, seed, analysis) is committed.
4. Stage 1 gate under V1 (24 runs, $1.9045 real): done; result `needs_stage_2`, kept as a pilot (decision 5).
5. V2: grader path and test-file leak review (Opus), tasks gated again, V2 registration committed.
6. Stage 1 gate under V2 (24 runs of arm C, about $2; a separate operator approval).
7. Stage 2 gate if C failed somewhere under V2 (24 runs of arm A, about $25 by the S5 per-run figure; a separate operator approval).
8. The result goes into ES-22 and ES-23; the operator rules on R1 and G4. Nothing is pushed without the operator.

## Out of scope

- The text steer (arm B) and G4. A later experiment.
- The effort levels `medium` and `high`. `low` already ties `xhigh` on the fix class.
- Packaging (ES-10) and the actuation design (ES-23).
- Cleanup of S5 leftovers: `s5-work/tasks` (64 GB) stays for reuse; the `s5-proxy` container and the pasted OAuth token still need to be stopped and revoked.

## Open items for the plan

- The exact `when` and confidence of R1, checked against `compileRule` in `decide.mjs`.
- Where the Stage 0 script lives (`effort-steering/spikes/s5/`) and how the runner takes a prompt file in place of `TASK.md`.
- Whether the task `CLAUDE.md` keeps its test-command lines when the prompt is a trace.
- The prereg fields for this experiment and the simulation of the analysis.
