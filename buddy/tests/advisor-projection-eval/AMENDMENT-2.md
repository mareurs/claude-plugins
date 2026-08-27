# Amendment 2 — the scorer conflated missing data with negative data

**Made 2026-08-27, after A1 and A2 ran, before any verdict was declared.** Filed
separately so the defect stays legible.

## What happened

`A2-plus-security/run-5.txt` is **0 bytes**, and `run-5.err` is 0 bytes too. The
process produced no output at all — no response, no error. It is a failed run.

`score.py` read that file, found none of the RETAIN markers in it, and scored
`retain=False`. That is counted identically to a run in which the model *answered*
and *omitted* its output contract.

So the scorer returns the same value for two different worlds:

- the model displaced the primary's contract — **evidence against the premise**
- the harness produced no data — **no evidence either way**

A measurement that cannot distinguish those is not measuring displacement
(`claude-plugins:W-4`). And the direction matters here: it biases **against** the
premise, so it would have produced a more conservative-looking result that was
nonetheless wrong. A2's RETAIN over *valid* runs is 4/4, not 4/5.

## Fix

1. `score.py` now classifies a 0-byte response as `INVALID`, excludes it from the
   denominator, and reports invalid runs separately. An arm with any invalid run is
   not scored until it is re-run to the pre-registered n.
2. `run_arm.sh` already re-runs on an empty file (`[ -s "$R" ]`), so the repair is to
   re-invoke the arm rather than to hand-patch the tally.
3. **The pre-registered n is n valid runs.** This is stated now rather than assumed,
   because "n=5" silently meant "5 attempts" and the two are not the same number.

## Why this is recorded rather than quietly fixed

It is the seventh instance of one shape in a single session, and the third *inside
the eval built to measure the premise*: the LEAK observable pointed at a string the
payload does not contain (`AMENDMENT-1.md`), the ruling-extraction grep returned 6 of
7, and now the scorer reads absence-of-data as data.

Every one was caught by a check performed *after* authoring — a re-read, a reviewer,
or a spot-check of an anomalous number. None was caught by the authoring pass. The
pattern is consistent enough that the remedy looks structural: **a discriminator must
be validated against the case it is meant to discriminate before it is trusted**, and
that validation is a separate step, not an attribute of writing carefully.

## Status of the eval at the time of this amendment

- A1 (instrument control): RETAIN **5/5** valid. Instrument has power; eval not void.
- A2: RETAIN **4/4 valid**, 1 invalid run pending re-run.
- A3: not yet run.
- Behavioural leak: not yet read. **No verdict may be declared until it is.**
