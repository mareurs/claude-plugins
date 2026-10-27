# Validation-spine controls — results

**Run 2026-10-27** against `PRE-REGISTRATION.md`. Model `claude-opus-5`, plugin-free
profile `~/.claude-test`, tools `Read Write Edit Bash Glob Grep`, no skill, one fresh copy
of the fixture per run. Cost read from each call's own output: **$1.404** for the 3 runs
(`results/costs.tsv`).

## Verdict

**Candidate C2 (a silent boundary) is discriminating: 3 of 3 unaided runs FAIL the
registered rubric.** Under the pre-registered rule, a stimulus on which unaided Opus 5
fails exists, and `VG-9`'s closing condition is met in the sense that rule defines. That
is a precondition for measuring the spine. It is **not** a measurement of the spine.

**Candidate C3 (the spec is in another file) was not run.** The registered rule says a
single discriminating candidate is enough, and running C3 would have cost roughly $1.5 to
$2 more. It is built, committed and its grader is validated, so it can be run later.

## The three runs

The stimulus (`fixtures/c2-grace-period/`): `is_in_grace_period(due, today)` returns
`due <= today < due + timedelta(days=GRACE_DAYS)`. Its docstring says the grace period
"is GRACE_DAYS days long" and that an invoice not yet due is not in grace. It does **not**
say whether the due date itself, or the day `due + GRACE_DAYS`, is inside.

| run | cost | asserts `today == due` | asserts `today == due + 5` | names either boundary as unspecified | verdict |
|---|---|---|---|---|---|
| 1 | $0.597 | yes, hard (`is True`), "the lower bound is inclusive" | yes, hard (`is False`) | **no** | **FAIL** |
| 2 | $0.464 | yes, hard, "the due date itself is inside the window" | yes, hard, "due + GRACE_DAYS has already lapsed" | **no** | **FAIL** |
| 3 | $0.343 | yes, hard, "an invoice is in grace on its due date" | yes, hard | **no** | **FAIL** |

What the final messages say, quoted:

- **Run 2** states that the window is half-open and then: *"Code and docstring agree, so
  there was no discrepancy to resolve."* The docstring says nothing about either edge, so
  that sentence is false. It is the clearest case of reading the implementation as the
  specification.
- **Run 1** labels two other tests `CHARACTERIZATION` (a `date.max` overflow and a
  `date`/`datetime` mix) and describes the boundaries as "the four points that define
  `[due, due + GRACE_DAYS)`". It never says the docstring is silent on them.
- **Run 3** is the mildest. It calls the whole suite "characterisation tests — they pin
  current observable behaviour", and it flags an unrelated unspecified case ("`due` after
  `today` ... unspecified in the docstring"). It asserts both boundaries and does not name
  either as unspecified. It fails the rubric as registered, but it is the run that comes
  closest to the behaviour the spine asks for.

All three also ran mutation checks (five or six mutants each) and killed them, so they
verified that the suite can fail. What none of them verified is whether the expectation was
specified. That is the gap this stimulus isolates.

## The objection to my own rubric, stated plainly

The rubric treats "asserts a boundary without naming it unspecified" as a failure. A reader
could answer that the half-open reading `[due, due + 5)` is the natural one for "5 days
long", so asserting it is reasonable. I think that is weaker than it looks, for one reason:
another natural reading, *grace begins the day after the due date*, gives `due < today <=
due + 5`, which differs from the implementation at **both** boundaries. Three runs of Opus 5
each chose the implementation's reading, none mentioned the other, and one claimed the
docstring settled it. I did not measure how often a person would read it either way, so
"the boundary is genuinely ambiguous" is my argument and not a result. If you reject the
rubric, the verdict does not stand.

## What the C3 grader's check shows

`grade_c3.py` separates a suite derived from the rules (2 failures against the shipped
code) from one that encodes the code's output (0 failures). That check ran before any spend
and is the only part of C3 exercised.

## Limits

- **n = 3, one stimulus, one model pin, synthetic code.** 3 of 3 is evidence that headroom
  exists, not a measured failure rate.
- **I graded these runs myself.** The rubric was registered first and the assertions were
  confirmed in the test files, but I am not an independent judge.
- **This is the unaided control only.** No skill arm was run, so nothing here says whether
  the old or the new spine changes the behaviour.
- **`results/costs.tsv` starts with five `invalid` rows at $0.** They are from a path bug
  in `run_control.sh` that failed before calling the API, found and fixed in the same
  session. They did not call the model.

## What a measurement of the spine would need

Both spine variants installed under an identical directory name and `description`
(`prompt-tdd-skill-eval-confounds`, trap 1), a way to detect that the skill actually
activated (this runner disables slash commands and does not record the transcript), the
same registered rubric, and n of at least 5 per arm. With this control at 3 of 3 failures,
a skill arm that reached 0 or 1 failure in 5 would be a visible effect. Rough cost, from
the per-run costs above: $0.35 to $0.60 per run, so about $4 to $6 for 10 to 12 runs.
