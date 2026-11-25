---
kind: entry
status: open
title: 'A-3: prompt-hamsa''s own craft surface — H12 (claude-plugins skill) and codescout P-6 …'
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 21, id `A-3`) on 2026-11-25; audited 2026-08-27.

**Artifact:** prompt-hamsa's own craft surface — H12 (claude-plugins skill) and codescout P-6 (`docs/trackers/prompt-hamsa-audit-log.md` § Protocol). Audited after A-2's eval concluded.

**Symptom:** Observed, local, n=1. A-2's `PRE-REGISTRATION.md` shipped a verdict rule whose failure signal is an ABSENCE (behavioural leak ≤ 1/5). That observable returns 0 both when projection works AND when the advisor text was never attended to at all, so the rule returns `premise holds` in both worlds. The eval was rescued only by an UNREGISTERED observable (advisor-citation count: A2 5/5, A1 0/5, A3 0/5) noticed while reading blinded responses.

**Gap:** NOT a missing rule. The law is already stated in THREE places, all of which were in context when the pre-registration was written: (1) P-6 demands a three-way checker split — passing trace, failing trace, and ABSENT-BEHAVIOUR trace, `all three must split correctly`; (2) global memory `behavior-eval-bind-the-artifact` states it outright — `only a POSITIVE CONTROL separates the treatment does nothing from the treatment never reached the model`; (3) H9, which P-6 cites. The gap is between having the rule and applying it. AMENDMENT-1 ran P-6's split PARTIALLY — it caught that verbatim-leak fails pass-vs-fail and replaced the observable — then never re-ran the third trace against the replacement. And the absent-behaviour trace was already in the design as arm A1: collected, scored, printed in the same table. A1 was designated the instrument control for RETAIN, so its leak column was never read as the absent-behaviour trace for LEAK.

**Move:** NO-SHIP a new heuristic. A fourth statement of a law already stated three times is the exact accretion H2 must later cut, and the demonstrated failure mode is not absence of the rule but non-application of a present one — H10's finding says that lever is a structural gate, not more text. Instead: promote P-6's three-way split from a protocol BULLET to a REQUIRED, PRE-FILLED FIELD of the pre-registration — a three-row table (treatment works / treatment fails / treatment absent) whose predicted observable values the author writes down BEFORE running, with the stop rule: two rows holding the same value means the observable is dead. Exact precedent: `pre-register-model-and-n-near-threshold` made model and N required fields for the same reason — `pre-registration only protects what it explicitly checks`.

**Prediction:** Falsifiable claim: with the three-row table as a required pre-registration field, an author writing an absence-shaped observable is forced to write the same value in two rows and sees the defect at authoring time. HELD if the next pre-registration with an absence-shaped failure signal either carries a treatment-side positive control or is stopped by the table. FAILED if a filled-in table still ships a non-discriminating observable — which would mean the form is decoration and the real lever is elsewhere. Explicitly NOT predicted: that more prose in H12 or P-6 would help.

**Eval status:** absent — claim is UNVERIFIED, n=1 field observation. A form field is not cheaply A/B-able; the outcome lands on the next absence-shaped eval, not on a run I can schedule.

**Confidence:** medium

## Record

## A-3 — the law was stated in three places that were all in context, and still did not fire

**Audited:** prompt-hamsa's own craft surface — H12 and codescout P-6 — immediately after
`A-2`'s eval concluded. **2026-08-27.** Observed, local, n=1.

`A-2`'s pre-registration shipped a verdict rule whose failure signal was an **absence**
(behavioural leak ≤ 1/5). That observable reads 0 both when projection works and when the
advisor text was never attended to at all, so the rule returns *premise holds* in both worlds.
The eval was rescued only by an **unregistered** observable — advisor-citation count, 5/5
against 0/5 and 0/5 — noticed while reading blinded responses.

**The finding is not a missing rule.** The law was stated in three places, all in context when
the pre-registration was written: P-6's three-way checker split, a global memory saying
outright that *only a positive control separates "the treatment does nothing" from "the
treatment never reached the model"*, and H9. The absent-behaviour trace was even already in the
design as arm A1 — collected, scored, printed in the same table — but A1 had been designated
the instrument control for RETAIN, so its leak column was never read as the absent-behaviour
trace for LEAK.

Move: **no-ship a fourth statement of the law.** Instead promote P-6's three-way split from a
protocol bullet to a **required, pre-filled field** — a three-row table (treatment works /
fails / absent) whose predicted values the author writes before running, with the stop rule
*two rows holding the same value means the observable is dead*.

**Outcome: still null, and deliberately so.** `eval_status` is *absent* — a form field is not
cheaply A/B-able, so the verdict lands on the next absence-shaped eval rather than on a
schedulable run. `RM-24` is a candidate for exactly that test.

Structured fields live in `params.audits`; this section exists to make `A-3` citable.
