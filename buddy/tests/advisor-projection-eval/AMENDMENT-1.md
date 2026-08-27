---
id: '7810f94d40c00c68'
kind: note
status: active
title: Advisor projection eval — amendment 1, made before any arm was run
tags:
- eval
- pre-registration
- amendment
---

**Made 2026-08-27, after committing `PRE-REGISTRATION.md` (`e71b805`) and before
running a single arm.** No data existed when this was written. Recorded as a
separate amendment rather than edited into the original, so the original rule and
its defect stay legible.

## The defect

`PRE-REGISTRATION.md` names **LEAK** as an exact-string match on
`**Severity:**` / `**Exploit sketch:**` / `**Category:**` — security-ibex's Finding
Format fields.

**Those strings are not in the A2 payload.** Projection removes the advisor's
output-contract section; that is the whole mechanism under test. Verified against
the generated arm: `"**Exploit sketch:**" in payload` is `False` for A2.

So for the model to score a LEAK, it would have to *invent* field names it has
never seen in its context. That is close to impossible, which means LEAK is
near-guaranteed to be 0 — **in the world where projection works and equally in the
world where it fails.** A check that returns the same value under both hypotheses
is not a check (`claude-plugins:W-4`). It would have produced a green result that
proved nothing, and I would have reported "premise holds" on it.

## What the falsifier actually predicts

The spec's falsifier says the model may *"adopt the advisor's voice or emit its
output format."* Re-read literally against a payload that contains neither: the
realistic failure is not verbatim reproduction. It is **displacement** — the model
answers as a security reviewer because the advisor's heuristics are security-shaped
and nothing in the payload says they are advisory, so the primary's own output
contract gets crowded out.

That is observable, and it is observable on the *primary's* fields, which **are**
in the payload.

## Amended observables

- **RETAIN (load-bearing).** Response contains any of `**Contract:**`,
  `**Mutation-survival:**`, `**Boundaries covered:**`. In the payload for every arm,
  so it can move in either direction.
- **DISPLACEMENT** = A1 RETAIN − A2 RETAIN. This is the falsification signal.
- **BEHAVIOURAL LEAK.** Read by hand, all 15 responses, bound to their arm: does the
  response present as a *security finding* (severity ratings, exploit framing,
  vulnerability-first structure) rather than as a *test review*? Recorded per run
  before any tally, per the harness doc's *bind response ↔ score*.
- **VERBATIM LEAK.** Retained, demoted, and reported as expected-0. A 0 here is not
  evidence for the premise. It is only worth recording because a *non*-zero would be
  a genuine surprise worth chasing.

## Amended decision rule

Instrument positive control unchanged and still voiding: **A1 RETAIN < 4/5 → VOID.**

| A2 result | verdict |
|---|---|
| RETAIN ≥ 4/5 **and** behavioural leak ≤ 1/5 | **Premise holds.** No-ship the header clause; amend the spec to *verified*. |
| RETAIN = 3/5, or behavioural leak = 2/5 | **Inconclusive.** Raise N to 15 before deciding. |
| RETAIN ≤ 2/5 **or** behavioural leak ≥ 3/5 | **Premise falsified.** Ship the header clause; retire the falsifier. |

## Note

The original rule was not sloppy in an obvious way — it named exclusive field
identifiers, which is exactly the right *technique*. It failed because I chose the
discriminator without checking whether the string it discriminates on was reachable
in the arm under test. The check was well-formed and pointed at nothing, which is
the fifth instance of this shape tonight and the first one caught before it produced
a number.

