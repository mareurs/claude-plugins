# Validation-spine A/B — pre-registration

**Registered 2026-10-27, before any A/B call.** Follows `PRE-REGISTRATION.md` and
`RESULTS.md` in this directory: candidate `C2` was found discriminating (3 of 3 unaided runs
failed). This eval asks the question `VG-9` has carried since 2026-08-26: **does either
version of the validation spine change the behaviour on a stimulus where unaided Opus 5
fails?** It works on `VG-9` in `docs/trackers/validation-domain-coverage.md`.

## Arms

All on `fixtures/c2-grace-period`, the same request, model `claude-opus-5`, the plugin-free
profile `~/.claude-test`, tools `Read Write Edit Bash Glob Grep Skill`, skills **enabled**.

| arm | skill installed at `.claude/skills/validation-spine/SKILL.md` |
|---|---|
| **A0** | none |
| **OLD** | `prompt-engineering/prompts/skills/spine-variants/old/validation-spine/` (the numbered seven-step choreography, 2,011 bytes) |
| **NEW** | `prompt-engineering/prompts/skills/spine-variants/new/validation-spine/` (the outcome-framed rewrite, 1,147 bytes) |

The two variants have the **same directory name and the same frontmatter `description`**
(checked 2026-10-27), so the only difference between OLD and NEW is the body. That is the
confound control from `prompt-tdd-skill-eval-confounds`, trap 1.

**n = 5 valid runs per arm, fresh.** The three earlier unaided runs are not pooled into A0:
they ran with `--disable-slash-commands` and a different output mode, so they are a
different configuration. They are reported next to A0 for reference only.

## Observables

- **FAIL / PASS per run**: the `C2` rubric registered in `PRE-REGISTRATION.md`, unchanged.
  *FAIL = the suite asserts either boundary (today == due; today == due + 5 days) and does
  not name that same boundary as unspecified, ambiguous or not stated in the docstring.*
  **The rubric is applied blind** (see below).
- **ACTIVATION per run**, recorded for every arm by `run_ab.sh` from the call's stream: the
  number of `Skill` tool calls, and whether the skill's own text appears in the stream
  (`checks you write must be able to fail`, `Follow this procedure exactly`). A skill arm run
  **activated** if either is non-zero. A0 is expected to show 0 and is the check that the
  detector does not fire on its own.

## Blind protocol

After all runs finish, `blind_ab.py` writes each run (final message, then the test file) to
`blind/R01…R15.txt` under a deterministic content-hash shuffle, and writes the key to a
separate file that is not opened until the last score is recorded. Each response gets its
FAIL/PASS recorded before any tally. A response that names the skill ("per the validation
spine") reveals its arm; I cannot hide that, and will note how many did.

## Decision rule — pre-registered, checked in this order

Let k0, kOLD, kNEW be the FAIL counts out of 5 for A0, OLD, NEW.

1. **Headroom.** If k0 < 3, the stimulus does not discriminate in this configuration. Stop:
   **not informative about the spine.** (The earlier 3 of 3 was under a different flag set;
   this checks it still holds.)
2. **Activation.** If fewer than 4 of 5 runs in a skill arm activated, that arm is **not
   informative about the skill's content**, because it measured the base model. Report it
   as that, not as "no effect".
3. **Effect, per skill arm that passed 2.** The arm **helps** if k0 − k ≥ 3. It shows **no
   detectable effect** if k0 − k ≤ 1. A difference of exactly 2 is **inconclusive.**
4. **OLD against NEW.** Compared only if at least one arm helps. NEW is better if kOLD −
   kNEW ≥ 3, OLD is better if kNEW − kOLD ≥ 3, otherwise **not distinguishable at n = 5.**

Both ITT (all valid runs) and activated-only results are reported. The verdict uses ITT.

## One pilot, registered

Before the 15 runs, **one NEW run** to check on the real model that the harness activates
the skill at all. If it shows no activation evidence, run **one more** NEW pilot. If that also
shows none, **stop**: the harness cannot activate the skill in this configuration, and the
arms would measure the base model. Pilot runs are not part of any arm.

## Budget and stop rules

Shared **$15** cap. About $2.08 is spent (`RM-24` and the controls); this eval's cap in
`results-ab/costs.tsv` is **$9** including pilots, so the total stays under about $11.2.
Opus runs on this fixture cost $0.34 to $0.60. Every call's `total_cost_usd` is summed
before the next call, and each call carries `--max-budget-usd 2`. If the first two arms cost
more than $5.50 together, stop before the third and re-plan.

## Stated limits

- **n = 5 detects only a large effect.** A difference of 3 of 5 is the smallest that this
  rule calls an effect; smaller true effects will read as "no detectable effect".
- **One stimulus, one model, synthetic code.** A skill that helps here may not help on real
  repositories, and one that does not may help elsewhere.
- **I score the runs myself, blind to the arm where the response allows.** The rubric is
  fixed first, but I am not an independent judge, and some responses will name the skill.
- **Activation is the model's choice.** A skill that activates rarely is measured by the
  activated-only reading, which has a smaller n.
- **This measures one behaviour** (naming an unspecified boundary), the spine's third clause.
  It says nothing about the spine's other requirements.
