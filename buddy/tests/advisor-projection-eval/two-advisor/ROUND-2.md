# Two-advisor eval, round 2 — pre-registration

**Registered 2026-10-27, before any round-2 call.** Round 1 (`RESULTS.md`) was not
informative about crowding-out because `architecture-snow-lion` was named in 0 of 5 B2
responses: the stimulus never gave it anything to say. Round 2 changes the stimulus and
nothing else.

## What changes, and what does not

- **Changes:** the stimulus, to `stimulus-2.md` (`export_orders`: an f-string query and an
  unchecked `org_id` for the security advisor; query, formatting, email and audit in one
  function for the architecture advisor).
- **Unchanged:** the primary, the three arms, the advisors, the observables including the
  amended RETAIN (`AMENDMENT-1.md`), LANDING, the behavioural read, the decision rule, the
  invalid-run handling, the model pin, the isolation, and the budget. Everything in
  `PRE-REGISTRATION.md` as amended applies to round 2 verbatim.

## The pilot — one, registered, not repeated

The round-1 failure was about whether the advisors register at all, and that can be
checked cheaply **before** spending on three arms. So:

1. Run **B2 only, 3 valid runs, on `stimulus-2.md`**.
2. **The pilot passes if each advisor, `security-ibex` and `architecture-snow-lion`, is
   named (exact string) in at least 2 of the 3 pilot runs.**
3. If it passes, run the full round 2 (B1, B2, B3 at 5 valid runs each, fresh runs; the
   pilot runs are **not** reused as arm data).
4. If it fails, **stop.** Record the pilot, record that this stimulus also did not make
   both advisors register, and do not revise the stimulus and re-pilot in this session.
   One pilot, one stimulus: a loop of "adjust until it lands" is a search for a result,
   and this one is bounded on purpose.

The pilot selects on LANDING, which is a precondition for the question, and not on RETAIN
or leakage, which are the question. The pilot does not read or score RETAIN. If the pilot
passes, the full round must still clear LANDING at 4/5 for each advisor, as registered,
or it is again not informative.

## Budget

Round 1 cost $0.495 for 15 runs. The pilot is about 3 runs, and a full round about 15, so
this adds roughly $0.60. It is inside the share of $4 for this eval and the shared cap of
$15.
