# Validation-spine controls — pre-registration

**Registered 2026-10-27, before any control run.** Committed first, on the same terms
as `buddy/tests/advisor-projection-eval/PRE-REGISTRATION.md`. Works on `VG-9` in
`docs/trackers/validation-domain-coverage.md`.

## The question

`VG-9`'s closing condition, as rewritten after the spine ablation: **a stimulus exists
on which unaided Opus 5 measurably fails, established by controls before any arm is
built.** This eval looks for such a stimulus. It does **not** measure the spine: no
skill arm is built here, and a result on the controls says nothing about whether the
spine helps.

## Why the previous stimulus was retired

The docstring-contradiction stimulus (`prompt-engineering/scenarios/validation-spine/`)
was cleared by every unaided run: six no-skill controls were recovered from transcripts
and three read in full all passed both judge rubrics. The pass bar sat below Opus 5's
floor, so neither skill variant ever had headroom. About $5.30 was spent before that
was known. That fixture is not re-run here, at any n.

## Two candidate stimuli

They follow the two guesses recorded in the archived passover
(`docs/trackers/archive/passover-validation-spine-2026-08-26.md`, next action 3).

- **C2 — a silent boundary** (`fixtures/c2-grace-period/`). `is_in_grace_period(due,
  today)` has a docstring that says the grace period is `GRACE_DAYS` long and says
  nothing about whether the due date itself, or the day `due + GRACE_DAYS`, is inside
  it. The code answers both. A suite that asserts those two boundaries as if specified
  is encoding the implementation. The spine's third clause says to name the unspecified
  case instead.
- **C3 — the specification is in another file** (`fixtures/c3-spec-elsewhere/`).
  `late_fee_cents` has no rules in its docstring. `docs/billing-rules.md` says 2% per
  **full** 30 days overdue, capped at 10%. The code uses `ceil`, so it charges 2% on day
  1 and 4% on day 31. The request names only `src/late_fee.py`.

Both use the same neutral request as the old stimulus: *"Write a pytest suite for …
I'm about to refactor this module and want tests in place first."* Neither request
hints that anything is wrong.

## What a run is

`run_control.sh`: model `claude-opus-5` (the pin `validation_spine_opus5.yaml` used),
the plugin-free profile `~/.claude-test`, tools `Read Write Edit Bash Glob Grep`, a fresh
copy of the fixture in an empty directory, no skill. The final message and the whole
working directory are saved, so every run can be read afterwards.

## The rubrics — registered now

**C2.** Read the test file and the final message. Record, for each of the two
boundaries (today == due; today == due + 5 days): *asserts* (a hard assertion for that
exact day, not skipped or xfailed) and *flags* (the final message, or a comment, or an
xfail/skip reason, names that boundary as unspecified, ambiguous or not stated in the
docstring). **The run FAILS if it asserts either boundary and does not flag that same
boundary.** It passes otherwise, including a run that never tests the boundaries.

**C3.** Run `grade_c3.py <run_dir>`: it runs the model's own tests against the *shipped*
code and reports how many fail. Read the final message for a statement that the code
contradicts the rules document. **The run PASSES (caught) only if at least one of its
tests fails against the shipped code AND the final message reports the mismatch.** It
FAILS if the suite is green against the shipped code (it certifies the bug, or never
reached it) or if it fails without saying why.

**The discriminators were checked before any spend.** `grade_c3.py` was run on two
hand-written suites: one with expectations taken from the rules document (2 failures
against the shipped code) and one that encodes the code's own outputs (0 failures). C2's
rubric was applied to the same two hand-written behaviours: a suite asserting both
boundaries with no flag fails it; a suite that tests the specified cases and names the
two boundaries passes it.

## Decision rule — pre-registered

n = 3 valid unaided runs per candidate, read as above.

| FAIL count | verdict for that candidate |
|---|---|
| 3 of 3 | **Discriminating.** A stimulus on which unaided Opus 5 fails exists. |
| 2 of 3 | **Discriminating, weakly.** Extend to 5 valid runs if the budget allows; it stays discriminating only if at least 3 of 5 fail. |
| 0 or 1 of 3 | **Not discriminating.** Retire the candidate, as the old fixture was. |

If either candidate is discriminating, `VG-9`'s closing condition is met and it is
recorded as such, with the limits below. If neither is, `VG-9` stays open and both
retired candidates are recorded with their data.

## Budget and stop rules

The whole effort shares a **$15** cap with `RM-24`. This eval's share is at most
**$10**. Every call's `total_cost_usd` is appended to `results/costs.tsv`, and no call
starts once the sum reaches the cap; each call also carries `--max-budget-usd 2`. If
the first candidate's cost per run exceeds $1.50, stop and re-plan before the second.
No `prompt-tdd report`, no `--paired`, no `max_cost_per_run`, no re-run of the old
fixture: the passover's four anti-goals hold.

## Stated limits

- **n = 3 is small.** A 2-of-3 or 3-of-3 failure rate on one stimulus is evidence that
  headroom exists, not a measured rate.
- **I grade the C2 runs and read the C3 messages myself.** The rubric is registered
  and the C3 test result is mechanical, but I am not an independent judge.
- **One model pin, one run configuration, synthetic stimuli.** A failing stimulus here
  may not fail on real code.
- **A discriminating stimulus is a precondition, not a result.** It does not show the
  spine helps; that needs arms, which are not built here.
