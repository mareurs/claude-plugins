---
id: '795cb91f2bb14aaa'
kind: bug
status: fixed
title: 'buddy-introspection reports `specialists_scanned: 10/10` against a roster that has grown to 12 — two specialists have never been audited'
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
unverified: The reporting defect is fixed; the underlying gap is not. codescout-pika and prompt-hamsa remain UNAUDITED — the tracker now names them as pending instead of hiding them behind a 10/10. S-1..S-6 'Applies to (N/10)' counts are still scoped to the audited ten. And no check derives the denominator from buddy/skills/, so a thirteenth specialist would again be invisible.
---

## Summary

`docs/trackers/buddy-introspection.md` § Live state declares
`specialists_scanned: 10/10` at `last_updated: 2026-05-15`. `buddy/skills/` holds
**twelve** specialists. `codescout-pika` (316 lines — the largest file on the roster) and
`prompt-hamsa` (158) have never been audited on the prompt-craft axis.

`10/10` reads as complete. The audit is complete against a population captured in May.

## Symptom (Effect)

Three consumers inherit a scope that is wrong by two:

- **Every `S-N` row's `Applies to (N/10)` count** understates by an unknown amount. `S-4`
  and `S-5` are recorded as `10` — i.e. universal — when the roster has twelve members and
  the two unexamined ones are the largest (`codescout-pika`) and the one that defines the
  audit's own heuristics (`prompt-hamsa`).
- **`docs/trackers/validation-domain-coverage.md` `VG-7`** nominates `codescout-pika` as
  the roster's top trim candidate without noting it has never been audited.
- **`docs/trackers/active-plan.md`'s `T-35`** (quarterly hamsa sweep, `next: 2026-08-15`,
  overdue at time of filing) has no signal that its scope grew by two.

## Reproduction

```
sed -n '/^specialists_scanned/,/^specialists_pending/p' docs/trackers/buddy-introspection.md
ls -d buddy/skills/*/ | wc -l          # → 12
grep -c 'prompt-hamsa' docs/trackers/buddy-introspection.md   # → 0
grep -c 'codescout-pika' docs/trackers/buddy-introspection.md # → 0
```

`hamsa` appears in that tracker five times, all as the **auditor** (the H1–H8 heuristics),
never as an auditee.

## Environment

- `claude-plugins` @ `2d6cdbe`, buddy plugin version **0.9.1**
- `buddy-introspection.md` `last_updated: 2026-05-15`
- Twelve directories under `buddy/skills/`; ten named in `specialists_scanned`

## Root cause

`N/N` notation encodes progress against a population captured at write time, and nothing
re-derives the denominator. Once numerator and denominator match, the value is
indistinguishable from "complete" — so the tracker reports full coverage of a roster it
no longer covers, and reports it more confidently the longer it goes unmaintained.

This is a distinct failure from a stale *measurement*: a stale number is wrong and
checkable, a stale denominator is **structurally invisible**, because the only thing that
would reveal it is a recount nobody has a reason to run.

## Evidence

Specialists present in `buddy/skills/` but absent from `specialists_scanned`:

| Specialist | `SKILL.md` lines | Audited? |
|---|---:|---|
| `codescout-pika` | 316 | never |
| `prompt-hamsa` | 158 | never |

For context, the ten that *were* audited measure 118–136 lines
(see `docs/issues/2026-08-26-buddy-introspection-20-outlier-comparison-falsified.md`).

## Fix

1. Change `specialists_scanned: 10/10` to `10/12`, or add an explicit
   `specialists_unaudited: [codescout-pika, prompt-hamsa]` key so the gap survives a skim
   without anyone recounting `buddy/skills/`. The second form is preferable — it names
   what is missing rather than leaving a subtraction to the reader.
2. Re-check each `S-N` row's `Applies to (N/10)` denominator when the two are audited.
3. Fold the two into `T-35`'s scope before the overdue sweep runs.

**Note the ordering constraint:** `prompt-hamsa` supplies the H1–H8 heuristics the audit
scores against. Auditing it is self-referential and should be scoped deliberately, not
folded in as an eleventh routine row.

### Applied 2026-08-26 — `d334a50` (patch-id `893c9e35072b8b14`)

- **Step 1 — done, in the preferred form.** `specialists_scanned: 10/12`, and
  `specialists_pending: []` replaced with both names spelled out plus their line counts
  (`codescout-pika` 316, `prompt-hamsa` 158). The gap now survives a skim without anyone
  recounting `buddy/skills/`, which was the stated reason to prefer naming over
  subtraction. `last_updated` moved to 2026-08-26. A scope-correction block sits at the top
  of § *Audit scope and methodology*, where "all 10 buddy specialists" is still asserted.
- **Step 2 — deliberately NOT done, and now labelled instead of implied.** The
  `Applies to (N/10)` denominators are unchanged, with a note under the systemic table
  stating they are scoped to the audited ten rather than the roster. Re-basing them means
  reading two specialists against six rubrics — real work, and inventing numbers for it
  would reproduce this very bug. The `prompt-hamsa` self-reference constraint above still
  stands and is the reason to schedule it rather than absorb it.
- **Step 3 — not done.** `T-35`'s scope is untouched; the quarterly sweep is still overdue
  (due 2026-08-15) and still scoped to ten. Folding these two in remains open work.

**Found while fixing this, and larger than the row it came from:** `S-5` — *"No eval set
(zero graded examples per specialist)"*, severity `high`, and per § *Field semantics* the
row that *"blocks everything from reaching `passing`"* — is **fully falsified**. All twelve
specialists now have `buddy/tests/<specialist>-eval/` with two prompt-tdd scenarios and a
`prompt_tdd.yaml`. `prompt-hamsa-eval` is the one irregular layout (older bespoke harness,
prompt-tdd form nested a level down), which is why a top-level config check reports it
missing when it is not. Closed in the same commit.

That mattered beyond bookkeeping: `S-5` was the stated reason no finding could reach
`eval_status: passing`, which is why the per-specialist table's Status column had drifted
into meaning *"not eval-confirmed"* rather than *"not done"* — the exact misreading that
put already-shipped work into a session handoff as pending. See
`roster-audit-session-log` `F-9`.

## Tests added

None. See `unverified:`.

## Workarounds

None. Readers must recount `buddy/skills/` by hand to learn the tracker's scope.

## References

- `docs/trackers/buddy-introspection.md` § Live state — the stale declaration
- `docs/trackers/active-plan.md` `T-35` — the overdue sweep that inherits the scope
- `docs/trackers/validation-domain-coverage.md` `VG-7` — nominates an unaudited specialist
- `roster-audit-session-log:F-2` — the reconnaissance entry this issue is filed from
- `reconnaissance-patterns:R-3` — the promoted cross-cutting lesson
- `docs/issues/2026-08-26-buddy-introspection-20-outlier-comparison-falsified.md` — sibling staleness in the same tracker
