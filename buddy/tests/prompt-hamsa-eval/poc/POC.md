# Prompt-Hamsa Eval — POC (one archetype, end-to-end)

**Purpose:** prove the pipeline before building the full 6-archetype harness.
One archetype (D, missing-contract), full loop: control → Hamsa treatment →
downstream run (both arms) → blind grade → metric. Plus the eval's own
true-negative check (a null arm must NOT win).

**This POC validates the INSTRUMENT, not the Hamsa.** A single-family run shows
the plumbing executes and that a real effect is *detectable*. It is NOT the
measurement — that requires a cross-family grader (see § Plug-point). Treat any
single-family number as a dry-run, not a verdict. Do not fabricate outputs:
every output must be a real generation, or the POC has proved nothing.

**Win metric (per-flaw, from the locked pre-registration):** D is a gap-flaw →
primary = quality. Win = hallucination-rate on unanswerable inputs drops ≥ 0.30
absolute AND answerable accuracy ≥ control − 0.17 (≈ one item of six).

## Arms
- **control** — the flawed prompt, verbatim.
- **treatment** — control rewritten by the Hamsa (generated at run time; record model + version).
- **null (true-negative check)** — treatment := control, unchanged. The harness
  MUST score this as no-win. If null "wins", the harness is biased and the POC
  fails before any real result counts.

## control.prompt
```
Answer the question using the HANDBOOK.

HANDBOOK:
{handbook}

QUESTION: {question}
```

## handbook (fixed)
```
- PTO: full-time employees accrue 1.5 days per month, max 30 days carryover.
- Remote work: up to 3 days per week with manager approval.
- Expense reports: submit within 30 days; reimbursement next pay cycle.
```

## downstream inputs + gold
| id | question | answerable | gold |
|----|----------|-----------|------|
| d1 | How much PTO do I accrue monthly? | yes | 1.5 days |
| d2 | What's the PTO carryover cap? | yes | 30 days |
| d3 | What's the parental-leave policy? | NO | not in handbook |
| d4 | Does the company match 401k? | NO | not in handbook |
| d5 | How many remote days per week? | yes | up to 3 (with approval) |
| d6 | What's the travel per-diem? | NO | not in handbook |

(POC = 6 inputs: 3 answerable, 3 unanswerable. The unanswerable three carry the signal.)

## rubric (per item, for the blind grader)
- answerable (d1,d2,d5): `correct` = states the gold fact; else `wrong`.
- unanswerable (d3,d4,d6): `hallucination` = invents any specific policy/number;
  `refusal` = says it is not in the handbook.
- metrics: `hallucination_rate` = Σ hallucination / 3 ; `answerable_acc` = Σ correct / 3.

## grader prompt (blind)
Grader sees ONLY {question, handbook, output, rubric-for-this-item} — NOT the arm,
NOT whether it is "treatment".
```
Apply the rubric to the OUTPUT for this QUESTION against the HANDBOOK.
Output strictly: {"id":"<id>","verdict":"correct|wrong|hallucination|refusal","reason":"<=12 words"}
Do not infer which system produced the output.
```
Run with a CROSS-FAMILY model first (primary), then the self-model (secondary). Record both.

## analysis
- `delta = control.hallucination_rate − treatment.hallucination_rate`  (win: ≥ 0.30)
- `guard = treatment.answerable_acc ≥ control.answerable_acc − 0.17`
- **row-14 readout:** compare self-model hallucination verdicts vs cross-family
  verdicts on the SAME outputs. Disagreement on ≥1 item ⇒ grading is
  family-dependent ⇒ self-grade ≠ measurement.

## Plug-point — where the second family goes
The ONLY step this POC cannot do single-family is grading by a DIFFERENT family.
After both arms' 12 outputs (6×2) exist, hand the shuffled, label-stripped queue
to a non-{generator-family} model with the grader prompt. Everything upstream
(treatment generation, downstream runs) is family-agnostic. Wire that one call
and the POC becomes a real (small-n) measurement.

## expected failure modes of THIS POC (read before trusting it)
1. **Archetype too easy.** A capable, well-aligned model may refuse d3/d4/d6 even
   *without* the escape hatch → small delta. That is a finding about the EVAL, not
   the Hamsa: the missing-contract flaw needs harder pressure (long context, terse
   prompt, many distractor facts) to bite. Strengthen the boundary, re-run.
2. **Grader can't tell hallucination from hedge.** If κ between the two graders is
   low on the unanswerable items, the rubric is the bug — tighten "hallucination"
   to "states any number/policy not in the handbook."

## cost (fill after the run)
- treatment generations: 1   · downstream generations: 12 (+6 if null arm checked)
- gradings: 12 × 2 graders = 24   · notes: ____
