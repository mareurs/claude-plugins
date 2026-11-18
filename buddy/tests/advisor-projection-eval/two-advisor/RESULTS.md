# Two-advisor projection eval — results and verdict

**Run 2026-10-27**, against `PRE-REGISTRATION.md` as amended by `AMENDMENT-1.md`.
N = 5 valid runs per arm, 15 responses, one stimulus (`../stimulus.md`), model
`claude-sonnet-5-5` as recorded in each call's output, isolated profile, no tools.

## Verdict — NOT INFORMATIVE about crowding-out

The pre-registered rule is: *LANDING < 4/5 for either advisor in B2 → not informative
about crowding-out; the advisors were not attended to, so a clean result proves
nothing.* LANDING in B2 was **3/5 for `security-ibex` and 0/5 for
`architecture-snow-lion`**. The architecture advisor was never named, so the rule
resolves here, before the displacement and behavioural reads can carry any weight.

**This is not "premise holds" and must not be quoted as one.** It says the eval could
not have shown crowding-out, because one of the two advisors left no trace in any
response.

## What was measured

| arm | valid n | RETAIN (amended) | RETAIN (original) | names `security-ibex` | names `architecture-snow-lion` |
|---|---|---|---|---|---|
| **B1** primary alone | 5 | 5/5 | 4/5 | 0/5 | 0/5 |
| **B2** two relevant advisors | 5 | 5/5 | 4/5 | **3/5** | **0/5** |
| **B3** two size-matched irrelevant | 5 | 5/5 | 5/5 | 0/5 | 0/5 |

- **Instrument control passed.** B1 RETAIN is 5/5 under the amended markers (4/5 under
  the registered ones; see `AMENDMENT-1.md`). The eval was not void.
- **Verbatim leak, non-gating:** 0/5 in every arm, for both advisors' exclusive field
  names. As registered, a 0 here is what both hypotheses predict.
- B3's irrelevant advisors (`planning-crane`, `refactoring-yak`) were named in 0/5 B3
  responses, so size alone did not produce citations either.

## How `security-ibex` landed

All three citations in B2 are **referrals**, not adopted voice: "it is a design question
rather than a test gap, and I would raise it with security-ibex" (run 1); "a security
question, not a test gap, and one for the security-ibex" (run 2); "a referral to the
security-ibex lens, since I would be guessing at your threat model" (run 3). That is the
behaviour the one-advisor eval called the strongest form of projection working: the model
treats the advisor as a separate party to defer to.

## Where my design assumption failed

I chose `architecture-snow-lion` as the second relevant advisor because the stimulus puts
its authorization check inline in the handler. The data say the stimulus does not tempt
it. The word "architect" appears in none of the 15 responses, nor "snow lion", nor
"ADR"; "coupling" or "layer" appears in 2, 1 and 2 responses of B1, B2 and B3, so it does
not separate the arms. The pre-registration called the stimulus a tempt for both
advisors. For the second one that was a guess, and this eval did not check it first.

## One unregistered comparison, not to be over-read

In the one-advisor eval (`../RESULTS.md`) `security-ibex` was named in 5/5 A2 runs. Here it
is named in 3/5 B2 runs. Those are different experiments: `testing-snow-leopard` has
since grown by 23 lines (its payload is 27,350 characters, not 24,079), and B2 carries a
second advisor. At n = 5 against 5, 5/5 versus 3/5 has a two-sided Fisher exact p of
0.44. It is consistent with the two advisors diluting each other's landing, and equally
consistent with chance. It is **not** evidence of crowding-out, and the registered
LANDING rule already says what to do with a low count.

## What was not done

- **The blind behavioural read was not performed.** The registered rule resolved on
  LANDING before that read could change the verdict, and a read of responses that mention
  an advisor 0 times would not repair that. B2's RETAIN is 5/5 and no response contains
  either advisor's exclusive fields, so nothing here suggests displacement, but that is
  mechanical evidence only.
- **No second round was run.** See below.

## What a second round needs

The next design must establish LANDING for both advisors **before** the arms are run. The
cheapest way is a one-arm pilot on a candidate stimulus: run the two-advisor arm a few
times and check that each advisor is named. A stimulus has to give each advisor something
it must say (for example, a function with an injectable query *and* three tangled
responsibilities), or the second advisor has to be one this task does tempt. This costs
about the same as this round, which cost **$0.495** for the 15 runs.

## Limits — unchanged, and they bind the claim

- N = 5 detects a large effect only, and this round detected none because it could not.
- One stimulus, one relevant pair of which one never landed, and the payload is delivered
  in the user turn.
- The amendment to RETAIN was made after seeing B1 and before any treatment arm. Both
  scores are reported.
- Two smoke calls ($0.0053 and $0.0195) ran outside the eval's cost log, to check the
  login and the model pin.

## Reproduction

`python3 make_arms.py <dir>`, then `bash run_arm.sh <dir> results <arm> 5 4` per arm,
then `python3 score.py results`. Responses: `results/<arm>/run-{1..5}.txt`. Per-call
costs: `results/costs.tsv`. The prompts are not committed; `make_arms.py` regenerates
them from the shipped assembler.

## Round 2 — the pilot failed, and the round stopped as registered

`ROUND-2.md` registered one pilot (B2 only, 3 valid runs, new stimulus `stimulus-2.md`)
and a stop rule: each advisor named in at least 2 of 3 runs, else stop and do not
re-pilot. Result, on `claude-sonnet-5-5`, cost **$0.160**:

| advisor | named in pilot runs |
|---|---|
| `security-ibex` | **3/3**, every time as a deferral ("a question for security-ibex", "route the finding itself to security-ibex") |
| `architecture-snow-lion` | **0/3** |

The pilot fails. **No round 2 arms were run**, and the stimulus was not revised. RM-24
therefore remains unanswered: nothing has been shown about two advisors, in either direction.

What this adds, as a design finding for a third round and not as a result:

- **Naming an advisor measures deferral, not attention.** `security-ibex` is named
  because the model hands a security question to it. That is only possible when the
  advisor's domain is *outside* the primary's. An advisor whose domain overlaps the
  primary's (testability, boundaries, design) gets applied silently by the primary, so
  its heuristics can shape the answer and leave no name. LANDING-by-name can then read
  0 while the advisor is fully attended.
- So a third round needs an observable that does not depend on citation, for example the
  presence of vocabulary that only an advisor's heuristics introduce, validated first the
  way `AMENDMENT-1` validated RETAIN, or advisors chosen only from domains outside the
  primary's.
- The data are in `results-round2/pilot/`. The prompts are regenerated by
  `make_arms.py <dir> stimulus-2.md`.

Total spend for this eval across both rounds: **$0.655** for 18 runs (round 1 $0.495,
pilot $0.160), plus two smoke calls of $0.025 outside the cost logs.
