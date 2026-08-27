---
id: 218fa3ca8f62b18a
kind: bug
status: fixed
title: 'buddy-introspection #20''s "3× baseline / highest length" comparison is falsified, so its `Fix: Accept` disposition rests on arithmetic that no longer holds'
tags:
- buddy
- buddy-introspection
- tracker-drift
- roster-audit
closed: 2026-08-26
fix_patch_id: 893c9e35072b8b1480a0b7be44deeb3237b05724
fix_sha: d334a50 (main)
opened: 2026-08-26
severity: med
unverified: 'The VERDICT is not re-derived, only its evidence retracted — "is 181 lines justified?" is a question about rank, unanswerable until codescout-pika (316) is audited, and that specialist is outside audit scope. Also still no regression coverage: nothing re-derives a length comparison from source, so the same staleness recurs silently the next time the roster grows.'
---

## Summary

`docs/trackers/buddy-introspection.md` `#20 — security-ibex — Length 167 lines`
carries three claims beyond the line count in its heading:

> **Symptom:** Highest length of any specialist (others 47–60 lines). Token budget
> roughly 3× per specialist baseline.
>
> **Root cause:** Security complexity genuinely demands the additional sections […]
>
> **Fix:** Accept. Revisit if usage telemetry shows attention drift mid-session.

All three are now false or unsupported. `docs/trackers/validation-domain-coverage.md`
`VG-8` re-measured only the heading's integer (167 → 181) and filed that as low-severity
drift, leaving the disposition standing.

## Symptom (Effect)

`#20` is dispositioned **Accept** on the reasoning that `security-ibex`'s length is a
justified 3× outlier. Neither half of that premise holds:

- **"Highest length of any specialist"** — `codescout-pika` is 316 lines, `security-ibex`
  is 181.
- **"others 47–60 lines" / "roughly 3× per specialist baseline"** — the ten specialists
  `buddy-introspection` lists under `specialists_scanned` measure **118–136** lines
  today. 181 against that baseline is ~**1.4×**, not 3×.

A reader trusting `#20` concludes the roster has one long outlier that was deliberately
accepted. The roster actually has a uniformly heavier body across the board and a
different largest file, which is a different finding with a different fix.

## Reproduction

```
grep -n -A4 '^#### #20 ' docs/trackers/buddy-introspection.md
wc -l buddy/skills/*/SKILL.md
```

## Environment

- `claude-plugins` @ `2d6cdbe`, buddy plugin version **0.9.1**
- Measured against `buddy/skills/` **source**, not the plugin cache
- `buddy-introspection.md` `last_updated: 2026-05-15`

## Root cause

The drift check re-measured the datum in the finding's **title**. A title carries the
cheapest thing to re-measure and the least of the reasoning; the claims that make the
finding actionable sat four lines below it and were never opened.

Underneath that: `#20` recorded a **comparison** (X vs. the rest of the roster) as if it
were a **measurement** (X is 167). A measurement goes stale when its own subject changes;
a comparison goes stale when *anything in its reference class* changes — which is far more
often, and is invisible to a check that re-measures only the subject.

## Evidence

Per-file line counts, `buddy/skills/*/SKILL.md`, 2026-08-26:

| Specialist | Lines | In `specialists_scanned`? |
|---|---:|---|
| `codescout-pika` | 316 | no |
| `security-ibex` | 181 | yes |
| `prompt-hamsa` | 158 | no |
| `data-leakage-snow-pheasant` | 136 (+59 `_classic`, +129 `_llm`) | yes |
| `ml-training-takin` | 130 | yes |
| `testing-snow-leopard` | 125 | yes |
| `planning-crane` / `debugging-yeti` | 123 | yes |
| `refactoring-yak` / `performance-lammergeier` | 121 | yes |
| `architecture-snow-lion` / `docs-lotus-frog` | 118 | yes |

Audited-ten range: **118–136**. `#20`'s stated range: **47–60**.

## Fix

Re-open `#20` rather than re-stamping its line count:

1. Replace the Symptom line with today's measured comparison, or drop the comparison and
   state the absolute length only.
2. Re-derive the **disposition**. "Accept, it's a justified 3× outlier" does not survive
   at 1.4× with a larger file elsewhere on the roster. The live question is whether the
   *whole roster* has drifted heavy — which is a `headroom-optimization.md` backlog-2b
   question, not a per-specialist one.
3. Widen `VG-8` in `docs/trackers/validation-domain-coverage.md` from "the number moved"
   to "the comparison behind the disposition is falsified", and raise it above low.

### Applied 2026-08-26 — `d334a50` (patch-id `893c9e35072b8b14`)

- **Step 1 — done.** `#20`'s row and detail now carry the measured distribution as a table
  (181 not 167; second not highest; 118–316 not 47–60; 1.47× not 3×), and the row status
  reads **re-opened** rather than a silently re-stamped integer.
- **Step 2 — partially done, and the remainder is genuinely blocked.** The disposition is
  re-opened and its reasoning retracted in place. It is **not** re-derived: `Accept` may
  still be correct for 181 lines, but the argument it rested on (*security complexity earns
  the extra budget*) is an argument about **the** outlier, and settling rank requires
  auditing `codescout-pika` first. Recorded under `unverified:`.
- **Step 3 — done.** `VG-8` widened from "the number moved" to "the disposition rests on a
  falsified comparison", with the measurement-versus-comparison decay asymmetry written out,
  and closed.

**One thing this issue's own Evidence table now gets wrong, worth naming rather than
quietly fixing.** It lists `testing-snow-leopard` at 125 and `data-leakage-snow-pheasant`
at 136. Both moved *later the same day* — to **148** (`VG-6`, the new Properties and
Invariants section) and **141** (`VG-7`, the lens re-extraction). The audited-ten range is
therefore **118–148**, not 118–136. The table was accurate when written and is left as
written, because the drift is the point: this file's central claim is that a comparison
decays whenever its reference class moves, and its own reference class moved within hours
of filing. None of the conclusions turn on it — "47–60" and "highest" fail against every
reading of the roster, before or after.

**Not fixed, and not in scope here:** no check derives either the line counts or the
comparison from `buddy/skills/`. This class recurs on the next roster change.

## Tests added

None. See `unverified:`.

## Workarounds

None needed — nothing executes from `#20`. The cost is a wrong conclusion inherited by
the next reader, and by `active-plan.md`'s `T-35` quarterly sweep.

## References

- `docs/trackers/buddy-introspection.md` `#20` (L347–355) — the entry
- `docs/trackers/validation-domain-coverage.md` `VG-8` — the under-scoped drift finding
- `roster-audit-session-log:F-1` — the reconnaissance entry this issue is filed from
- `roster-audit-session-log:W-1` — the pattern that surfaced it
- `reconnaissance-patterns:R-3` — the promoted cross-cutting lesson
- `docs/issues/archive/2026-08-26-buddy-introspection-scope-stale-10-of-12-specialists.md` — sibling staleness in the same tracker
