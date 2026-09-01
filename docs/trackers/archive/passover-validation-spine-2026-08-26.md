---
id: 1ccde24ea18b6138
kind: tracker
status: archived
title: Passover — validation-spine measurement — 2026-08-26
tags:
- passover
- validation
- prompt-tdd
- eval
topic: validation-spine-measurement
time_scope: dated:2026-08-26
branch: main
sibling_repo_branch: prompt-engineering@master
---

## State

An AI-eng/DS **validation domain-coverage audit** shipped as `validation-domain-coverage.md`
(`VG-1`..`VG-10`, committed by another session as `08029a7`). Its prompt spine was rewritten
from numbered choreography to outcome framing on first-party evidence, and then an ablation
was built and run to measure whether that rewrite helped. **Verdict, resolved 2026-08-26 at
zero further spend: the STIMULUS is non-discriminating and is retired.** Six no-skill control
runs were recovered from the Claude Code transcripts — they had been there the whole time,
missing only attribution — and three read in full all clear both judge rubrics unaided. The
pass bar sits below Opus 5's unaided floor, so neither variant ever had headroom. The spine
remains a better-argued hypothesis, not a measured one; `VG-9` stays `mitigated`, now blocked
on a *new* fixture rather than on more runs of the old one.

Building the eval turned up four defects in `prompt-tdd` itself, filed as
`prompt-engineering:prompt-tdd-operating-guide` `OP-13`..`OP-16`. One of them (`OP-15`) would
have silently corrupted the planned measurement, so the design changed before the money was
spent. Roughly **$5.30** of real API spend so far (4 generator invocations at ~$1.32, two of
them wasted on an accidental `report` re-execution).

## Next actions

**Actions 1, 2 and 4 are DONE. Only the rebuild remains, and it is not urgent.**

1. ~~Verify the working state~~ — **done.** The peer's Pheasant edits landed as `0fd8eb1`, and
   they also closed `VG-6` and `VG-8` and shipped buddy 0.9.2. Their re-extraction refuted
   `VG-7`'s success metric on algebra: `(base + lens) / monolith` is invariant under
   relocation, so it could not respond to the fix it asked for. `VG-7` is now `fixed` and its
   conditional discharged; the roster measures 2125 lines by a stated method.
2. ~~Decide the stimulus question~~ — **done, and the answer is no.** Not "probably too easy"
   but measured: 6 no-skill controls, 3 read in full, all 3 clear both rubrics. Full evidence
   in `VG-9` and in `prompt-engineering:skill-eval-log`. Generalised as
   `skill-eval-playbook` `L-17`.
3. **Rebuild the stimulus above the unaided floor, and run the CONTROL FIRST.** This is the
   only open action. The requirement is a task where unaided Opus 5 measurably fails,
   established by controls *before* any variant is built — that ordering is now step 4 of the
   playbook's checklist rather than step 5. The old note's guesses are still the best
   candidates: an *under-specified* edge the model must notice is unspecified rather than a
   flat contradiction, or a spec moved to a separate file so the test is whether the model
   seeks it out. Everything else carries over unchanged — confound controls, plugin-free
   profile, both configs, and the marker-per-arm attribution technique. Do not re-run the old
   fixture at any n.
4. ~~Owed `F-N` for the method failure~~ — **done**, as
   `claude-plugins:reconnaissance-patterns` `R-6` (`5f6ce6e`), not an `F-N`: `F-N`/`W-N` are
   per-work-stream namespaces and this stream opened no session log, while the lesson is about
   the reconnaissance skill itself. Verdict `miss`, proposal HELD behind the `R-4` eval
   baseline. Two further findings surfaced while verifying it — a filename in a citation's
   qualifier slot becomes a silent non-edge, and a fenced block exempts a citation you are
   writing *about* while backticks do not.

## Working state

- **`claude-plugins`** — branch `main`. Uncommitted: `docs/trackers/validation-domain-coverage.md`
  (**KEEP** — the `VG-9` measurement append, live-state counters and History entry from this
  session, +58 lines) and `buddy/skills/data-leakage-snow-pheasant/SKILL.md` (**NOT MINE** —
  a peer session's WIP, +7/-2; do not commit it as part of this work).
- **`prompt-engineering`** — branch `master`. All **KEEP**, all uncommitted:
  `scenarios/validation-spine/` (two scenario.yaml, verified by `diff` to differ in exactly
  three lines), `prompts/skills/spine-variants/{old,new}/validation-spine/SKILL.md`,
  `validation_spine_opus5.yaml`, `validation_spine_sonnet5.yaml`,
  `docs/trackers/prompt-tdd-operating-guide.md` (`OP-13`..`OP-16` + Index rows),
  `docs/trackers/skill-eval-log.md` (the eval's registration entry). Also present and **not
  mine**: `.codescout/memories/conclude-last-eval.md`, `scenarios/conclude-last/`,
  `results/conclude-last/`, `.codescout/constitution-seen/`, `M .codescout/memories/conventions.md`.
- **Processes:** none must be running. `ANTHROPIC_API_KEY` lives in
  `prompt-engineering/.env`; source it (`set -a; . ./.env; set +a`) before any run — it is
  not in the ambient env.
- **Known stale:** `VG-7` records the Pheasant at 136/59/129 = 324 lines. The working tree
  now reads 141/59/125 = 325 (`SKILL.md` committed at 136). The **ratio** the entry actually
  rests on is unmoved (81.8% for the `:llm` arm either way), so `VG-7` is still valid by its
  own declared condition — but re-measure before quoting its raw numbers, and do not edit
  that file while the peer session's WIP is in it.

## Anti-goals

- **Do not use `--paired`.** It discards both arms' per-run results (`OP-14`), a partly-errored
  arm silently depresses its own rate while the delta prints clean (`OP-15`), `power_margin` is
  hard-wired at 0.5 and unconfigurable, and it always exits 0. `skill-eval-playbook:L-15`
  prescribes it; that recommendation predates these findings.
- **Do not run `prompt-tdd report`.** It re-executes the whole suite at full cost with no
  output until finished, despite a docstring saying "from the last run" (`OP-13`). To re-read a
  finished run, read the Claude Code transcripts at
  `~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl` — they survive, correlatable by mtime
  only.
- **Do not re-file the "no per-run record is persisted" issue.** Already open as
  `prompt-tdd-operating-guide:OP-4` since 2026-08; a rediscovery cites it. Same for `OP-6`
  (cost cap short-circuits mid-arm).
- **Do not trust `max_cost_per_run`.** Dead key (`OP-16`). A config that sets it is unguarded.
- **Do not re-run the existing stimulus at scale hoping for discrimination** without first
  addressing action 2 — that is the walked dead end this passover exists to prevent.

## Open threads

- **`VG-9` open, but re-scoped.** The spine rewrite is still unmeasured; what changed is that
  the blocker is now a *missing fixture*, not missing runs. Closing condition rewritten to:
  a stimulus exists on which unaided Opus 5 measurably fails, established by controls before
  any arm is built.
- **`VG-10` open** — prompt artifacts should re-audit on model release, not on `active-plan`'s
  90-day `D-6` clock. Fix lands in `active-plan.md`, routed through `T-37`'s existing
  stale-detector rather than a second mechanism.
- **`VG-1`..`VG-5` and `VG-10` open** — the coverage gaps proper, untouched by this session.
  `VG-6` (property-based testing) and `VG-8` (stale ibex line count) were closed by a peer
  session, and `VG-7` fixed; all three are `fixed` as of buddy 0.9.2. Live-state counts
  updated to 6 open / 1 mitigated / 3 closed.
- **Lost result — RECOVERED, and it was the decisive one.** The `--ablate` summary was lost to
  an expired buffer handle, and the first recovery attempt called the transcripts
  "attributable only by mtime" and gave up. That was wrong twice over. They attribute on the
  first try by a **content marker unique per arm** (`Follow this procedure exactly` vs
  `So: the checks you write must be able to fail`, with `checks which cannot fail` /
  `Validation Spine` confirming absence in controls, and `_LEGACY_ALIASES` as the positive
  control that the search reached the right files). That resolved 4 OLD / 3 NEW / **6
  no-skill controls** — and the controls are what retired the stimulus. "Re-run rather than
  mine it further" was exactly the wrong call: mining it further cost nothing and answered
  the question a re-run would have obscured.
- **Method lesson — FILED, no longer owed.** Landed as
  `reconnaissance-patterns:R-6` in **claude-plugins**, not as an `F-N`: the `F-N`/`W-N`
  namespaces are per-work-stream and this stream never opened a session log in either repo,
  so there was no counter to append to. `R-N` was the right home anyway — the lesson is
  about the reconnaissance skill itself, and `R-1`..`R-5` are all this same family.
  Summary: the claim "runs are not auditable" was asserted from four observations, not one
  of them positive, and was **wrong** — transcripts are persisted, by Claude Code rather
  than by prompt-tdd, at `~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl`. Verdict
  `miss`; proposal **HELD** behind the `R-4` eval baseline (`n=0`) on `R-4`'s own reasoning,
  rather than promoted on argument.
  Mechanism worth carrying forward: unlike `R-4`, the law was **never loaded** — the
  reconnaissance skill was invoked later in the session. The `When NOT to Use` carve-out at
  `SKILL.md:20` already says "asserting a specific, checkable fact is not Q&A", but all
  three of its exemplars and its remedy are **source-shape** ("read the symbol this
  session"), and a claim about whether a tool persists anything has no symbol that settles
  it — so the situation resolved to read-only Q&A and the gate never asked for a scout.

## Pointers

- Audit and entries: `docs/trackers/validation-domain-coverage.md` (`VG-1`..`VG-10`, here).
- Load-cost consumer: `buddy/docs/trackers/headroom-optimization.md` backlog item 2b, which
  `VG-7` feeds with measured lens-split line ratios.
- Harness defects: `prompt-engineering:docs/trackers/prompt-tdd-operating-guide.md`
  (`OP-13`..`OP-16`; read `OP-4`, `OP-6` first as pre-existing).
- Eval registration: `prompt-engineering:docs/trackers/skill-eval-log.md` under
  *validation-spine (VG-9 spine ablation)*.
- Method the eval must satisfy: `prompt-engineering:docs/trackers/skill-eval-playbook.md`
  (`L-13`, `L-15`) and codescout memory `prompt-tdd-skill-eval-confounds` (three A/B traps,
  n>=10 floor).
- Adjacent initiative, different axis: `docs/trackers/buddy-introspection.md` audits how
  specialists are *written*; this one audits what the roster does not *cover*. `active-plan.md`
  owns the `T-N` namespace — file work there, not here.


## Consumed

Consumed 2026-09-01. Actions 1, 2 and 4 were already marked done in this file. Action 3 —
*"Rebuild the stimulus above the unaided floor, and run the CONTROL FIRST"* — is **still
open**, and is not lost by archiving: it is the same condition `VG-9` carries in
`docs/trackers/validation-domain-coverage.md`, which `librarian(action="doctor")` now
reports as `entry_conditional_past_due` (exposure 15), and it is tracked as
`docs/trackers/repo-remediation-backlog.md` `RM-10`.

`RM-10` repeats this file's four hard anti-goals inline rather than only linking here —
`--paired`, `prompt-tdd report`, `max_cost_per_run`, and re-running the old fixture —
because they are the part that cost real money to learn and a link is easy not to follow.
The rest of the method detail (confound controls, plugin-free profile, both configs, the
marker-per-arm attribution technique, and the recovered-controls story) stays here and is
still reachable: an archived artifact is not a deleted one, and a uniquely-defined citation
resolves into it normally.

Archived via `artifact(action="move")`, not `git mv`.
