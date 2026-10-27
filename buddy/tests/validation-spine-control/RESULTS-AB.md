# Validation-spine A/B — results

**Run 2026-10-27** against `AB-PRE-REGISTRATION.md`. Stimulus `C2` (`fixtures/c2-grace-period`),
model `claude-opus-5`, plugin-free profile, tools on, skills enabled, n = 5 valid runs per
arm. Arms cost **$7.707** (`results-ab/costs.tsv`); the activation pilot cost **$0.504** and is
not part of any arm. The scores were committed (`6faee2d`) before the arm key was opened.

## Verdict, by the registered rule

| step | check | result |
|---|---|---|
| 1 | Headroom: A0 fails at least 3 of 5 | **A0 fails 4 of 5**, so the stimulus discriminates in this configuration |
| 2 | Activation: at least 4 of 5 runs activated, per skill arm | **OLD 5/5, NEW 5/5** (A0 0/5, as expected) |
| 3 | Effect: fails reduced by at least 3 = helps; by 0 or 1 = no detectable effect; by 2 = inconclusive | **NEW: 4 → 1, reduced by 3: helps. OLD: 4 → 3, reduced by 1: no detectable effect.** |
| 4 | OLD against NEW, if one helps: a difference of at least 3 | **kOLD − kNEW = 2: not distinguishable at n = 5** |

| arm | FAIL | PASS | activated |
|---|---|---|---|
| A0 (no skill) | 4 | 1 | 0/5 |
| OLD (numbered choreography) | 3 | 2 | 5/5 |
| NEW (outcome framing) | 1 | 4 | 5/5 |

ITT and activated-only readings are identical, because every skill-arm run activated.

**What this says, in plain terms.** On this stimulus, the new spine moved Opus 5 from failing 4 of
5 to failing 1 of 5, which is exactly the registered threshold for "helps". The old spine moved it
from 4 of 5 to 3 of 5, which the rule calls no detectable effect. The two spines are not
separable with five runs each.

**What it does not say.** The registered rule is a threshold, not a significance test. A0 against
NEW (4/5 versus 1/5) has a two-sided Fisher exact p of **0.21**, so a reader who wants p < 0.05
does not have it. n = 5 sees only large effects. One stimulus, one model, synthetic code.

## The sensitivity that can change a verdict

Three runs flagged **one** boundary and treated the other as settled by the docstring. I scored
them FAIL under the registered rule, which requires the *same* boundary to be named:

- R02 (OLD) and R13 (OLD) and R03 (NEW) each flagged the upper boundary (`due + 5`) as a
  competing reading and called the lower one (`today == due`) fixed.

If flagging **either** boundary counted, those three become PASS, and the counts become
**A0 4, OLD 1, NEW 0**. Under that reading both skills help (reductions of 3 and 4) and they are
still indistinguishable (difference 1). So **the OLD verdict depends on how strict the rubric is.**
The registered strict rule gave "no detectable effect"; the lenient reading gives "helps". I did
not choose between them after seeing the arms: the registered verdict above stands, and the
lenient one is reported so a reader can weigh it. The NEW verdict ("helps") holds under both.

## Per-run record

Blind label, arm and my verdict (full reasons in `scores.tsv`):

| label | arm | verdict | label | arm | verdict |
|---|---|---|---|---|---|
| R01 | NEW run-4 | PASS | R09 | A0 run-2 | FAIL |
| R02 | OLD run-5 | FAIL (upper only) | R10 | A0 run-5 | PASS |
| R03 | NEW run-5 | FAIL (upper only) | R11 | A0 run-1 | FAIL |
| R04 | A0 run-4 | FAIL | R12 | NEW run-1 | PASS |
| R05 | NEW run-3 | PASS | R13 | OLD run-3 | FAIL (upper only) |
| R06 | A0 run-3 | FAIL | R14 | OLD run-1 | FAIL |
| R07 | OLD run-4 | PASS | R15 | NEW run-2 | PASS |
| R08 | OLD run-2 | PASS (borderline) | | | |

Examples of the behaviour the rubric separates. A PASS, from NEW (R15): *"The docstring never says
outright whether the window opens on `due` or the day after … this is inference, not something the
spec states."* A FAIL, from A0 (R11): the contract is stated as the half-open window
`[due, due + GRACE_DAYS)` and both boundaries are pinned twice, with the only flags on `date.max`
and call-time binding. R08 is the borderline PASS: it calls both boundaries "docstring readings"
and warns they may be wrong, while claiming the docstring implies them.

One more observation, not a finding: the OLD skill says *"If the spec does not determine it, list
the ambiguity and stop. Do not guess."* None of the five OLD runs stopped; all wrote a suite.

## How blind was the read

The heuristic search of the 15 final messages for a skill or the spine found **0** mentions, so no
message gave its arm away. I read the messages in full and the test files by search. Skill-arm
responses often use words like "characterization", but so did the controls, so that is not a tell
on its own. I am not an independent judge, and I had read the earlier unaided controls.

## Limits

- **n = 5 per arm.** The smallest difference the rule calls an effect is 3 of 5.
- **One behaviour.** This measures the spine's third clause (name the unspecified case). It says
  nothing about the other requirements.
- **One stimulus, one model pin, synthetic code.** A different stimulus, such as the
  pressure-to-relax shape in `VG-9`, is untested.
- **The unaided arm here is not the earlier control.** The first 3 controls ran with a different
  flag set; together with A0 the unaided record is 7 of 8 failing.
- **I scored the runs myself.** The rubric was registered first and the verdicts committed before
  the key, but the rubric has the strictness issue above.

## Reproduction

`bash run_ab.sh fixtures/c2-grace-period results-ab <A0|OLD|NEW> <skill dir|none> 5 9`, then
`python3 blind_ab.py results-ab`. The two skill variants are in `prompt-engineering/prompts/skills/spine-variants/`.
