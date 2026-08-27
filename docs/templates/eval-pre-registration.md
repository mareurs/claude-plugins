# Eval pre-registration — template

Copy this next to the eval (`<eval-dir>/PRE-REGISTRATION.md`) and fill it in
**before any arm runs**. Commit it before running. A decision rule written after
seeing results is not a decision rule.

Mirrors codescout `docs/trackers/prompt-hamsa-audit-log.md` § *Protocol* (P-1..P-8).
It lives here as well as there because the failure that produced § *Observable table*
happened in **this** repo, outside that protocol's stated binding — a gate only works
where the form is actually filled in.

---

## The claim under test

<What premise does the shipped code rest on that nothing currently measures? Quote
the spec's own falsifier if it has one. Name what the existing tests assert on, and
why that cannot reach this.>

## Why now

<What makes the baseline arm clean today and dirtier later? If a cheap remedy exists
that would PRE-EMPT the measurement, say so — insurance and measurement are often
mutually exclusive, and then the measurement goes first or never happens.>

## Arms

| arm | payload / condition | size |
|---|---|---|
| **A1** base (no treatment) | | |
| **A2** treatment | | |
| **A3** size-matched irrelevant control | | |

Generate arms with the **real** assembler, never a hand-written approximation.

A3 is not optional when the treatment adds bulk: without it, any A1↔A2 difference is
attributable to *more text* as readily as to *the treatment's content*
(`claude-plugins:W-4`).

## Observables

- **<NAME> (load-bearing):** <exact string match / mechanical check — prefer
  mechanical over judge wherever the behaviour is trace-observable>
- **<NAME> (secondary):** <…>

## Observable table — REQUIRED, fill before running

**One table per observable the decision rule reads.** Write what it *returns*, not
what you hope it shows.

### Observable: `<name>`

| trace | observable returns |
|---|---|
| treatment works | |
| treatment fails | |
| treatment absent (no treatment at all) | |

**Stop rule: if two rows hold the same value, the observable is dead. Fix it before
running.**

The collision to watch for is **works == absent**. That is the signature of a failure
signal defined as an *absence*: it reads identically when the treatment worked and
when the treatment was never attended to at all, so the rule returns "premise holds"
in both worlds and the eval measures nothing.

If your failure signal is an absence, you need a **treatment-side positive control** —
a second observable that goes to zero when the treatment is inert. Name it here and
check it first.

> Why this is a form field and not a bullet you are trusted to remember: on
> 2026-08-27 the rule was present in three places when the pre-registration that
> violated it was written, was applied *partially* (an amendment fixed
> works-vs-fails and never re-ran the absent trace against the replacement), and the
> absent trace was **already collected** — sitting in the baseline arm, scored and
> printed, but labelled for a different observable so nobody read it as the absent
> trace for this one. Recorded as `claude-plugins:A-3`.

## Instrument positive control — checked FIRST

**If <base arm's retention observable> < <threshold>, this eval is VOID and no
conclusion may be drawn from it.**

<Why: if the instrument has no power on the base arm, a low reading on the treatment
arm is indistinguishable from the instrument not working. This is `prompt-hamsa` H12
applied to the instrument rather than the treatment.>

## Decision rule — pre-registered

**N = <n> VALID runs per arm** — `n` means valid runs, not attempts. A 0-byte or
errored run is INVALID and excluded from the denominator, never scored as a negative.
Missing data is not negative data.

**Generator model: `<pinned model>`** — pinned explicitly, never inherited from an
ambient `/model`.

| result | verdict |
|---|---|
| <…> | **Premise holds.** No-ship. Amend the spec to *verified*. |
| <…> | **Inconclusive.** Raise N before deciding. |
| <…> | **Premise falsified.** Ship the change. |

## Stated limits

- **N = <n> detects a large effect, not a small one.** "Premise holds" means *no
  effect at a rate this design could see*, not *no effect*.
- **<one stimulus / one variant / delivery channel differs from production / …>**
- **What this does NOT measure:** <e.g. leakage is not benefit>
