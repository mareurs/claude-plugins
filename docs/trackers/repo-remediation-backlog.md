---
id: '88388ced5072c8b5'
kind: tracker
status: active
title: Repo Remediation Backlog (RM-N)
tags:
- backlog
- hygiene
- doctor
- remediation
topic: repo-hygiene
entry_high_water_RM: 24
entry_prefix: RM
---

# Repo Remediation Backlog (RM-N)

> **Purpose:** the remediation queue for findings that have an owner-less repair —
> `librarian(action="doctor")` violations, stale caveats, missing fix anchors,
> unconsumed handoffs. Opened 2026-09-01 from an open-issues sweep.
>
> **Prose ledger, deliberately.** Entries are `## RM-N — <title>` body sections and
> nothing else: no `params` rows, no hand-maintained index table. `link_scan` derives a
> citable token from a heading and from *nothing* else, so a row-only task list has
> entries nothing can ever reference — which is exactly the defect `RM-8` below exists to
> repair. One representation, one place to flip a status.
>
> **Allocate with `artifact(action="append_entry", id_prefix="RM",
> anchor_heading="## Template for new entries", title=…, body=…)`** — one call, which
> allocates the id, writes the heading at the right level, and advances the committed
> high-water mark. Never hand-allocate; a peer session in this checkout races you.

## Status vocabulary

`open` · `in-progress` · `done` · `blocked` (name the blocker) · `dropped` (say why on merit, not by default).

Statuses live on the entry's own `**Status:**` line. Flip it there; there is no second copy.

## Why the prefix is `RM` and not `T`

This ledger was created with `entry_prefix: T` and that was **wrong**: `active-plan.md`
already owns `T`, and `link_scan` reported the collision as a `prefix_conflicts` row
naming both artifacts within minutes. A bare `T-14` in this repo means active-plan's, and
a second declaring ledger would have made every one of those citations — including the
ones already in `INDEX.md` and in two passover trackers — ambiguous, resolving to
nothing. Re-prefixed to `RM` the same session, before any external citation existed.

Check `prefix_conflicts` before declaring a prefix. It is one field in a scan that has to
run anyway.

## A note on citing other ledgers from here

`F-N` / `W-N` are namespaced per work stream and have eight definers in this repo, so
they are cited **qualified by file stem** (`roster-audit-session-log:F-1`). `VG-N` and
`U-N` each have a single definer here and are cited bare. **`T-N` belongs to
`active-plan.md`** — do not write one here meaning something else.

**Other repos' task ids are deliberately not written as tokens anywhere below.** A bare
`T-14` in this body would be read as a citation of active-plan's `T-14`, and the
three-part `<repo>:<file-stem>:<TOKEN>` form has no supported grammar — it is retracted
and reported, never resolved. So cross-repo task entries are described (`"three of its
four tasks entries"`) rather than named. This is a limitation of the resolver, not an
oversight — do not "fix" it by adding the ids.

## Phase 1 — cheap and decisive

## RM-1 — Close the unterminated fence in the buddy global-config design spec

`docs/superpowers/specs/2026-05-21-buddy-global-config-home-design.md` holds **5** fence
lines, and the fifth is **line 153 of a 153-line file** — a stray opener at EOF. Every
line-anchored scan below it reads as code, so `**Valid:**`, `**Rests on:**` and
`- **SHA:**` are reported as *nothing declared* — true of the parse, false of the file,
and no error is raised anywhere.

Read the prose around line 153 before editing: a stray delimiter and a lost code block
need opposite repairs.

**Status:** fixed-verified 2026-09-01 — line 153 deleted; the file is now 152 lines with 4 fences, all paired (45/54 and 65/70). It was a **stray closer**, not a lost block: `git blame -L 153,153` dates it to `92d290a2`, the file's own creation commit and the same commit as the opener at line 45, and the `## Risks` bullets it followed end as complete prose with no sign of truncation. `doctor`'s `unterminated_fence` count is now 0.

One correction to this entry's own claim: it said `**Valid:**`, `**Rests on:**` and `- **SHA:**` below the fence were being reported as *nothing declared*. Checked — this file contains none of those lines, so nothing was actually being hidden. The repair removes a trap for any future declaration and for any line-anchored scan; it did not recover lost data. `doctor`'s detail text names those fields generically, and this entry read a generic warning as a specific one.

**Valid:** dated 2026-09-01

## RM-2 — Close the unterminated fence in the judge prompt

`eval/judge/prompt.md` opens a fence at **line 83** and never closes it, so lines 84–142
parse as code. Fence lines are 9, 63 (`json`, which sits *inside* the block opened at 9
because a closing fence may carry no info string), 79 (closes it), 83 (opens, unclosed).

Same silent-misparse consequence as `RM-1`. This file is a live prompt surface, so check
whether anything asserts on its rendered form before editing.

**Status:** fixed-verified 2026-09-01 — **and it was not a stray fence.** Line 9 opens the prompt template; line 63's ` ```json ` sits *inside* that block, and since a closing fence may carry no info string, line 79 — evidently meant to close the nested JSON example — closed the outer template instead, leaving line 83 (the template's real end, immediately before `## Notes on this prompt`) to open a block that never closed. Deleting 83, the obvious repair, would have left the template silently truncated at line 79, dropping its own *"The JSON block must be the LAST thing in your response"* instruction from the template body.

Fixed by nesting instead: the outer fences at 9 and 83 are now four backticks, leaving the inner ` ```json `/` ``` ` pair at 63/79 intact. All three fences date to `7606bce7`, the file's creation commit.

Checked what consumes the file before editing, as this entry asked: `eval/promptfoo.yaml:59` loads it as an `llm-rubric` rubric via `file://`, which reads raw contents — so the fences are **not** functional there and this was a parse-level fix only. That check is what surfaced `RM-22`, which is the more interesting question.

**Valid:** dated 2026-09-01

## RM-3 — Discharge the stale half of the reload-cap bug's `unverified:` field

`docs/issues/archive/2026-09-01-reload-block-inlines-45kb-over-the-hook-stdout-cap.md`
(`3f3f739030789f54`, re-keyed when `RM-12` archived it) carries `status: fixed` while its `unverified:` field still opens
with **"Not fixed — filed only."** The two contradict each other, and the field is what
the canonical triage query reads.

The caveat is only *half* stale. Discharge the "not fixed" clause — the fix shipped in
`584d804` + `8c6711c`. **Keep** the second clause: the 12,000-byte inline cap is derived
from a measured bound of (14,056 … 21,327], not from reading `maxResultSizeChars` /
`persistenceThresholdCeiling`, which were located in the 2.1.252 bundle but never
evaluated. That half is still exactly true and is the reason the field should not simply
be cleared.

**Status:** fixed-verified 2026-09-01 — the field no longer opens with *"Not fixed — filed only"*, which had contradicted its own `status: fixed`. Narrowed, not cleared: both surviving clauses are still exactly true and are the reason the caveat stays — the cap is an empirically bounded value, not a constant read from the bundle, and whether JSON `additionalContext` escapes the cap remains unknown with shape and size confounded across 130,958 observations. `closed: 2026-09-01` added.

Edited through `artifact(action="update", extra=…)`, not `edit_markdown`'s `frontmatter` param — the file carries a librarian `id:`, so its frontmatter is catalog-indexed and the direct edit is refused. Done before `RM-12` deliberately: archiving a record that says *"Not fixed"* under `status: fixed` would have baked the contradiction into the archive, where nothing re-reads it.

**Valid:** dated 2026-09-01

## RM-4 — Record the live end-to-end verification of the reload spill

Observed 2026-09-01 on a real main-session `/compact`, not a fixture: the hook wrote
`payload-file=.buddy/<sid>/reload-payload-compact.md` instead of inlining, and the
receiving session read **13,335 bytes** back out of it. Pre-fix, a payload that size was
truncated to a ~2 KB preview with no handle to fetch the rest — roughly 96% dropped.

This is the production observation the record's own caveat says it lacks. Write it into
the bug file (and `skill-loading-session-log` if it belongs there) while the numbers are
still exact.

**Status:** fixed-verified 2026-09-01 — written into the bug file as `## Verified live 2026-09-01`, with the marker line, the pointer, and the 13,335-byte read quoted from the receiving session's own context.

The write-up names what the observation proves and what it does not, because the number alone would over-claim: it establishes that the **spill branch** ran (13,335 B exceeds the 12,000 B `INLINE_CAP`), that the whole chain held in a real profile on a genuine `/compact`, and that the total-stdout bound `8c6711c` added worked — while leaving both `unverified:` caveats explicitly untouched.

**Valid:** dated 2026-09-01

## RM-5 — Push `0679eeb`

The `skill-loading-session-log:F-5` close is committed locally and unpushed. One command;
listed so it is not the thing that quietly stays local.

**Status:** fixed-verified 2026-09-01 — pushed as part of `139a3ed..807fda1`, together with the backlog itself, the `RM-21` bug file and its test fix. `git rev-list --left-right --count origin/main...HEAD` → `0 0`. Later work through `RM-2` pushed at `807fda1..d7847ea`.

**Valid:** dated 2026-09-01

## RM-6 — Repair the hostname label in the run-all zombie's caveat

`docs/issues/2026-08-05-test-run-all-pre-existing-failures-under-fresh-wsl.md`
(`2646bba03b528020`) has `unverified:` reading *"Green on ONE machine only (Arch Linux
workstation, `archlinux` host…)"*, but `/etc/hostname` on this box reads **`ripper`**.

The record cannot distinguish a rename from a genuine second machine — and "one machine
only" is the caveat's entire content, so the ambiguity destroys its value. Establish
which it is (a second confirming machine would *weaken* the caveat and is worth stating),
then fix the label.

**While in that file, add a disambiguation note pointing at `RM-21`.** The zombie's
re-check protocol is *"run `./tests/run-all.sh`, count FAILs"*, and the suite is red again
as of 2026-09-01 for a completely unrelated reason. Its `## Re-open trigger` is correctly
scoped — *"failures on any environment that is not this Arch workstation"* — so the
trigger does **not** fire and the record should stay `zombie`. But the next person
following the protocol sees `1 FAIL` and has every reason to read it as a recurrence.
Name the other bug there so that reading is closed off before it happens.

**Status:** open

**Valid:** dated 2026-09-01

## Phase 2 — record integrity

## RM-7 — Add `## Fix provenance` to the 8 terminal-status records that lack one

`doctor` reports 8 records with a terminal `status` and no fix anchor. Several are
**already in `docs/issues/archive/`**, where the convention makes the anchor mandatory —
so the archive pile has holes.

Record both lines per record: the SHA, and the patch-id from
`git show <sha> | git patch-id --stable`. The patch-id is what survives a rebase;
measured recovery for an orphaned SHA ran 2–153 ambiguous candidates. A merge commit has
no patch-id and `git patch-id` reports that by printing nothing and exiting 0 — cite the
constituent commits instead, and never leave the field empty. Where a record had no fix
commit at all, say so in `no_fix_commit:` rather than leaving it ambiguous.

Both 2026-09-01 bug files are in this set.

**Status:** fixed-verified 2026-09-01 — all 8 anchored; `doctor`'s `terminal_status_without_fix_anchor` is **0** (44 → 36 violations overall). Each fix commit was identified from the bug file's **own git history** (`git log -- <file>`), not guessed from a subject line. Four share `b93b612` (*"fix: four open bugs"*), and that repetition is annotated in place so it does not read as a copy-paste error. Two were campaigns rather than commits and carry every constituent SHA with its own patch-id: the citations bug (six commits, `6e4188c` → `d4c31ea`) and the reload-cap bug (`584d804` was a half-fix, `8c6711c` completed it, so `8c6711c` is the anchor). Every commit is single-parent, so every patch-id is real — a merge would have none and `git patch-id` reports that by printing nothing and exiting 0.

**Three SHAs already in those files were explicitly marked NOT the fix**, because a hash in prose reads as an anchor: `09170aeb…` is the head SHA of a PR in *another* repo (`mic-urs/codescout` #9 — the artifact under review), `ec034a46` is a codescout-repo commit, and `fedd7bc` was a concurrent session's unpushed commit named as a reason to *hold* an edit. `doctor`'s own detail text flags this shape: *"it does not merely lack an anchor, it READS as anchored."*

**Two lessons from doing it, both worth more than the anchors:**

1. **The check reads structure, not the heading.** My first pass gave the two campaign records a `## Fix provenance` section containing a markdown *table*. Both still counted as missing — detection is line-anchored on `- **SHA:**`, so the prettier form was invisible to it. Had I reported from the heading count (`grep -c '^## Fix provenance'` → 1 in every file) I would have claimed 8 of 8 while `doctor` still said 2. Both now lead with the bullet pair and keep the table below it.
2. **Verify the recorded id resolves, with a negative control.** Built the resolver the convention prescribes (`git log --all -p` → `git patch-id --stable`, via redirects because Iron Law 3 blocks the pipe) and looked up all six: 6/6 found, `deadbeef…` → 0. One lookup first returned 0 — **my grep prefix was mistyped** (`646843` for `64684d`), not the record. Worth noting as the shape it is: a transcription slip in the *check* that would have been read as a defect in the *thing checked*.

**Valid:** dated 2026-09-01

## RM-8 — Give the prompt-hamsa audit log's entries citable headings

`docs/trackers/prompt-hamsa-audit-log.md` (`720408ecd2391251`) has **no `A-N` heading
anywhere in its body**, so all three entries in its `audits` collection are uncitable and
every citation of any of them resolves to nothing. This is the ledger's entry *format*,
not one row's omission.

Fix by giving each entry its own heading of the exact defining shape — token, whitespace,
em-dash, title. Rows and rendered tables define nothing.

**Status:** open

**Valid:** dated 2026-09-01

## RM-9 — Declare a `**Valid:**` class on the 7 load-bearing undeclared entries

`doctor`'s `entry_cited_from_outside_but_undeclared` names 7: five in
`docs/trackers/buddy-introspection.md`, two in `docs/trackers/active-plan.md`. The check
fires only above a citation threshold, so each of these is something other files already
rest on.

An undeclared entry already means `dated <its last commit>` by default; the task is to
state the class that is actually true — `invariant`, `dated YYYY-MM-DD`, or
`conditional — <event>`. The check names an entry load-bearing, never "promoted" — that
judgement is the author's.

**Status:** open

**Valid:** dated 2026-09-01

## RM-10 — Adjudicate the two past-due conditionals in validation-domain-coverage

`doctor` reports two `entry_conditional_past_due` entries in
`docs/trackers/validation-domain-coverage.md`:

- `VG-9` (exposure 15) — conditional on *a stimulus exists on which unaided Opus 5
  measurably fails, established by controls before any arm is built.*
- `VG-5` (exposure 5) — conditional on *`prompt-hamsa` routes eval-construction requests
  to the playbook, or a base arm shows a deficit the playbook does not already cover.*

Check whether each happened. These are worklist items, not verdicts — the tool cannot
know, and "not yet" is a legitimate outcome that should be recorded rather than left
looking overdue.

**`VG-9` is a live work thread, not just an overdue flag — and its method notes are load-bearing.** Its condition *is* the one open action of the archived `docs/trackers/archive/passover-validation-spine-2026-08-26.md`: *"Rebuild the stimulus above the unaided floor, and run the CONTROL FIRST."* The old stimulus was **retired, not merely underpowered** — six no-skill control runs were recovered from transcripts, three read in full, and all three clear both judge rubrics unaided, so the pass bar sits below Opus 5's floor and neither variant ever had headroom. About **$5.30** of real API spend went in before that was known.

Read the archived passover before spending anything further. Its hard-won anti-goals, repeated here so they survive the link:

- **Do not use `--paired`** — it discards both arms' per-run results, a partly-errored arm silently depresses its own rate while the delta prints clean, `power_margin` is hard-wired at 0.5, and it always exits 0. `skill-eval-playbook:L-15` still prescribes it; that recommendation predates the findings.
- **Do not run `prompt-tdd report`** — it re-executes the whole suite at full cost despite a docstring saying "from the last run". To re-read a finished run, read `~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl`, correlatable by mtime only.
- **Do not trust `max_cost_per_run`** — dead key; a config setting it is unguarded.
- **Do not re-run the old fixture at any n.**

**`VG-5` appeared and then disappeared from the report inside one session — and it is still past due.** The check is gated on cross-file citation exposure from **live** artifacts, so an entry nothing depends on never generates work. Writing `RM-15` pushed `VG-5` over the threshold and `VG-9` from 14 to 15; then archiving four passovers under `RM-11` removed live citers and dropped `VG-5` back below the gate, with `VG-9` returning to 14. A `doctor` run today reports **one** past-due conditional, not two.

Do not read that as `VG-5` being resolved. Nothing about its condition changed — only the number of live files pointing at it. This is the *"a green result certifies the path that actually executed"* law applied to a worklist: the report going quiet is a fact about exposure, not about the condition. **Both entries stay in scope for this task**, and `VG-5`'s condition is quoted above so it survives its own invisibility.

A property of the instrument worth carrying: citation churn moves these counts in both directions, so a `by_check` delta across a session that archived or created trackers is not evidence of work done or undone.

**Status:** open

**Valid:** dated 2026-09-01

## RM-11 — Consume or archive the 5 active passovers

Five trackers carry `tags: [passover]` with `status: active`, the oldest dated
**2026-06-18** and **2026-07-04**. The documented discovery query returns all of them, and
its documented branch is *"multiple → pick by topic/branch"* — so every stale one makes
that choice harder for every incoming session, which is the opposite of what a handoff is
for.

Per the convention: flip `status: archived`, append `## Consumed — YYYY-MM-DD`, and move
into `docs/trackers/archive/` via `artifact(action="move")` — never a bare `git mv`, which
orphans the catalog row. Note `docs/trackers/archive/` does not exist yet.

Widest blast radius per unit of effort of anything in this backlog.

**Status:** fixed-verified 2026-09-01 — **4 of 5 archived, 1 deliberately kept active.** This entry's premise was that all five were unconsumed; adjudicating each against its own Next actions showed that was wrong, and force-archiving the fifth would have retired a live thread.

| passover | outcome |
|---|---|
| session-passover-tracker 2026-06-18 | archived — actions 1-4 discharged (Task 4's `## Trackers as cross-session behavior` section verified present at `librarian-runtime.md:193`, with the cross-ref from `tracker-conventions`); action 5 carried to `RM-23` |
| research-skills-refactor 2026-07-04 | archived — fully discharged; `32facf9` verified an ancestor of `HEAD`, and the release it was blocked on has shipped many times over |
| advisor-projection-eval 2026-08-27 | archived — the parked buddy release is done (**0.11.0**, tracker all-green); the open two-advisor question carried to `RM-24` |
| validation-spine 2026-08-26 | archived — its one open action *is* `VG-9`'s condition, already tracked by `RM-10`, which now repeats its four costly anti-goals inline |
| roster-audit + release-integrity 2026-08-26 | **KEPT ACTIVE** — nine live items in its `### Still open` list |

The kept one now carries a dated review note correcting its stale figures rather than leaving them to mislead: `buddy 0.9.1`/`cc 1.16.17` → `0.11.0`/`1.20.0`; ambiguous citations 93 → 64, **but not by the sweep it prescribes** (a `T` prefix collision fixed the same day did the arithmetic, and the bare-`F-N`/`W-N` sweep is still entirely undone); `R-4`'s eval baseline still **n=0**, while `R-5` was nonetheless promoted on a separate targeted screen, so its stated "do not promote a third law first" ordering no longer describes what happened. Items 3, 4, 5, 7 and 8 were left alone, not cleared — the note says so.

Each archive move went through `artifact(action="move")`, which re-keyed the id and grafted events/links. Citations of the old paths and ids were swept with `git grep` and no `--include` filters: seven hits, one live (`RM-23`, repointed), six historical — a `fixed` bug file's measurement quote, plan steps explicitly marked *"superseded, kept for history"*, and a `fixed-verified` session-log entry. Those were left as written; rewriting them would falsify records of what was true at the time.

**Valid:** dated 2026-09-01

## RM-12 — Archive the 7 fixed-but-unarchived bug files

`docs/issues/` holds 8 `fixed` records against 15 in `archive/`. Archiving re-keys the id
(`id = sha256(abs_path)`), so it must go through `artifact(action="move")`, and every
citation of the old path **and** the old 16-hex id has to be repointed in the same commit.
Drop the `--include` filters when sweeping for citations, or read the extension histogram
— a filter that misses a file type returns a clean zero that reads exactly like "no
citations".

**Status:** fixed-verified 2026-09-01 — **9, not 7** (the count in this entry's title predated two files closed later the same day, one of them `RM-21`'s). `docs/issues/` now holds one file: the `zombie`. All nine went through `artifact(action="move")`, each re-keying its id and grafting events/links; `archived_fix_sha_unresolvable` is **0**, which is `RM-7` paying off — that check only becomes reachable once a file is in `archive/`.

**26 live citations repointed** across `buddy/scripts/`, `buddy/tests/`, `codescout-companion/hooks/`, `pi/`, `tests/`, plus this backlog and six sibling cross-references between the archived files themselves. Shell rewriting is blocked on source files here, so each went through `edit_file`/`edit_markdown` individually; the hook's *"serialize write tool calls"* warning arrived mid-batch and the rest were serialized.

**Three instrument failures on the way, each of which would have left silent breakage:**

1. **Two citations were line-wrapped mid-path** (`…fires-parent-` / `…the-whole-command-`). A replace keyed on the full filename would have missed both and reported success. Keying on an unambiguous *path prefix* caught them — the encoding failure mode, where the artifact's own line wrapping defeats the literal.
2. **`git grep` could not see the moved files at all.** After `artifact(action="move")` the new paths are untracked, so `git grep` — which reads tracked content — was blind to precisely the nine files most likely to cite one another. The residual sweep came back clean while six stale sibling refs sat in them. Found by a direct `grep` against the archive dir. **After an unstaged move, `git grep` is the wrong instrument.**
3. **My own filter matched the path instead of the payload — twice.** `git grep … | grep -v 'archive/2026'` drops every line whose *filename* contains `archive/2026`, which is now all nine. Both times the wrong answer was a reassuring empty result. Fixed by testing the match field (`awk -F: '$3 !~ …'`).

**Deliberately not repointed:** `repo-hygiene-session-log:W-2`'s observation, which records the id and path `artifact(find)` returned on 2026-08-21. That is the measurement, not a pointer; rewriting it would falsify the record. It is now annotated in place so a future sweep subtracts it by inspection, and it is the **one net new dangling citation** (33 → 34) — unavoidable, because codescout has an open issue for the underlying limitation: an id cannot be *mentioned* without the scanner reading it as a citation.

`run-all.sh` exit 0, zero `FAIL` lines, buddy pytest **527 passed**, `prefix_conflicts` 0, `doctor` 36 (unchanged by the moves).

**Valid:** dated 2026-09-01

## Phase 3 — pointers into existing ledgers

These four are **pointers, not copies.** The linked entry is the source of truth and holds
the reasoning; duplicating its content here would create the two-formats-for-one-entry
defect that the conventions guide names as the generator of the rest. Flip the status in
the *entry*, then close the pointer.

## RM-13 — Triage the codescout-usage-audit Iron Law entries

`codescout-usage-audit-session-log` `U-1` … `U-5`: measured Iron Law violation counts —
`read_file` on source (45×), `read_file` on markdown (39×), `edit_file` on markdown (29×),
`edit_file` carrying a definition (22×), `grep` used where `semantic_search` was meant.
`U-1` already carries a Hookify assessment concluding no client hook is warranted.

**Status:** open

**Valid:** dated 2026-09-01

## RM-14 — Triage the roster-audit open entries

`roster-audit-session-log`: `roster-audit-session-log:F-1` (a drift finding re-measured
its own title; the falsified claim went unfiled — `VG-8` not yet widened),
`roster-audit-session-log:F-2` (a complete-looking audit with a stale denominator),
`roster-audit-session-log:F-5` (the session-log template cites its own ledger's ids bare,
so every fresh copy injects cross-repo dangling citations — needs a template-side fix),
`roster-audit-session-log:F-6` (filed upstream as a codescout issue), and
`roster-audit-session-log:W-4` addendum 2 (both promotion criteria unfired).

**Status:** open

**Valid:** dated 2026-09-01

## RM-15 — Triage the validation-domain-coverage gaps

`validation-domain-coverage`: `VG-3` (no owner for model-release gating; base arm owed
before any prose), `VG-4` (EDA/feature engineering — lowest priority, and its own escape
hatch rests on a false premise so a `wontfix` has to be argued on merit), `VG-5`
(re-scoped 2026-08-27 — the curriculum exists, so the gap is discoverability and the fix
is a trigger, not a specialist), `VG-10` (decision text drafted; the `D-N` allocation
belongs to `active-plan.md`'s owner).

**Status:** open

**Valid:** dated 2026-09-01

## RM-16 — Close out the repo-hygiene template-bootstrap friction

`repo-hygiene-session-log:F-2` — codescout's session-log template's own example
Index/Wins-Index row burns the id it displays, on the very first bootstrap. Related to
`roster-audit-session-log:F-5`: both are defects in the *template*, so both ship into
every fresh copy.

**Status:** open

**Valid:** dated 2026-09-01

## Phase 4 — cross-repo (found by a sweep run here; the work is elsewhere)

`librarian(action="doctor")` reads the whole catalog, not the active project. These are
filed so the findings are not lost, and should be worked from the owning repo — the
whatsapp worktree rows are deliberately excluded from this backlog.

## RM-17 — codescout: a citation names the archive path of a still-open bug

`codescout/docs/superpowers/plans/2026-09-01-request-aware-response-envelopes.md` cites
the `docs/issues/archive/…` form of `2026-09-01-a-scoped-read-is-billed-the-full-heading-map.md`,
which holds no artifact, while the live `docs/issues/` path does.

This is the form that schedules **no** repair: the citation-repair sweep is triggered *by*
an archive move, so a citation written before one fires no event and no procedure owns it
— it survives until a reader follows the link. Either repoint to the live path, or
complete the archive and repoint every citation in the same commit.

**The path above is deliberately not spelled out in full.** Writing it verbatim made *this
file* a second `premature_archive_citation` on the very first scan after it was created —
the scanner reads a description as a citation, so describing the defect reproduced it. If
you need the exact string, read it from `librarian(action="doctor")` rather than pasting
it back in here.

**Status:** open

**Valid:** dated 2026-09-01

## RM-18 — codescout: params/body status drift in system-retrospective-improvements

`codescout/docs/trackers/system-retrospective-improvements.md` — three of its four `tasks`
entries have a `params` status their body region does not state (two `params: done` and
one `params: in-progress`, all three reading `open` in the body). The two representations
answer the same question differently and **only the body is in git**.

Read the body, decide which side is right, repair the other. Note the check is a heuristic
in both directions: silent on ~8.6% of real disagreements, and it reports that a region
does not *state* the params status — never that the entry is wrong.

**Status:** open

**Valid:** dated 2026-09-01

## RM-19 — eduplanner-ui: params/body status drift in the open-bugs worklist

`mirela/eduplanner-ui/docs/trackers/open-bugs-worklist.md` — one of seven `tasks` entries
has `params: done` while its body status region states no enum value at all. Same remedy
and same heuristic caveat as `RM-18`.

**Status:** open

**Valid:** dated 2026-09-01

## RM-20 — Decide on the 10 rows outside managed roots

`doctor` reports 10 `abs_path_outside_managed_roots`: `avatar` ×2, `terasa` ×2, `PFA` ×3,
`pi` ×1. All those roots are live on disk, so this is not the dead-root case
`fix=prune_missing` exists for.

Decide once and record it: register the roots so the rows are managed, or accept the check
as informational for this machine. Leaving it undecided means 10 of every `doctor` run's
violations are permanent noise, which is how a real finding gets lost in the count. Use
`limit`/`offset` to page the window rather than reading the elided rows as absent.

**Status:** open

**Valid:** dated 2026-09-01

## RM-21 — run-all.sh is RED — the pre-push guard's positive control cannot fire

`./tests/run-all.sh` **exits 1** today. `tests/test-pre-push-guard.sh` fails 2 of 17, and
both are the parity deny-path assertions — one of which the test itself labels
*"POSITIVE CONTROL FIRST… every 'allow' below is uninformative"* if it does not deny. So
the five remaining parity passes carry no information by the test's own criterion.

Root cause, measured in both directions: the fixture fabricates drifted install records
for `codescout-companion` only, while the guard derives its subject from the most recent
`plugin.json` commit — which this session's buddy release (`30fd8dd`) made `buddy`. Parity
for `buddy` against that fake `$HOME` correctly takes the documented not-installed branch
and exits 0, so the assertion can never fire. The guard is behaving correctly; the fixture
is unreachable-by-construction.

It hid because `release.sh` runs the suite at **step 0**, before writing its own bump
commit — a release cannot observe the state it creates. And it will hide itself again: the
outcome is a deterministic function of which plugin was bumped last, so the next
codescout-companion bump flips it green with nothing fixed.

Full analysis, both measurements, and the fix (parameterise the fixture from
`bumped_plugins`, and assert the two sets are equal) in
`docs/issues/archive/2026-09-01-pre-push-guard-test-drifts-a-different-plugin-than-the-guard-checks.md`.

**Priority: highest in this backlog.** Everything else here is a record-integrity or
hygiene item; this one is a red suite gating a guard that exists to stop a bad version
bump reaching `main`.

**Status:** fixed-verified 2026-09-01 — `0495357` (patch-id `d2d3c39398b2cca7c731cbf2bf2934f29e053721`). `make_profiles` now derives its plugin set from the same expression `bumped_plugins` uses, so the fixture cannot name a plugin the guard does not check. Two assertions added and deliberately labelled apart: a fixture write-through (both sides derive from `BUMP_PLUGINS`, so it checks the writer only) and the real tie, which reads the plugin out of the guard's own stderr — the first draft of this fix had only the former and presented it as the tie, which would have been another check computed from the thing it judges. **Verified by mutation:** reintroducing the original defect turns the control and the real tie red (`guard=[] fixture=[codescout-companion]`) while the write-through stays green. `run-all.sh` exits 0, `✓ All suites passed.`, zero `FAIL` lines — read from the exit code, not the trailing tally.

**Valid:** dated 2026-09-01

## RM-22 — Does the judge rubric include the file's own methodology notes?

Found while checking what consumes `eval/judge/prompt.md` before editing it (`RM-2`).

`eval/promptfoo.yaml:59` wires the file in as the rubric for the `llm-rubric`
assertion:

```yaml
      rubric:
        file: file://./judge/prompt.md
```

A `file://` rubric is loaded as **raw file contents** — promptfoo does not extract
fenced blocks or strip markdown. So the judge appears to receive all 142 lines,
including the `## Notes on this prompt` section: the decompose-not-holistic rationale,
the CoT-before-JSON rationale, and their academic citations (FActScore, RAGAS, MT-Bench).
That material is *about* the prompt, addressed to whoever maintains it, not to the judge.

**This is a question, not a filed defect.** Two things need establishing before anything
is changed, and neither is knowable from the YAML alone:

1. Whether promptfoo really passes the whole file through here, or does something with the
   fenced template. Verify by running one case and reading the rendered rubric the provider
   actually received — not by reading promptfoo's docs, and not by reading this entry.
2. Whether it matters. The notes are coherent prose about evaluation methodology; a strong
   judge may simply ignore them. The frozen baselines under `eval/baselines/frozen/`
   (`ml-training-takin@v1..v3`) were all produced with the notes present, so if the rubric
   text changes, those baselines describe a different rubric than the live one — that
   coupling is the reason not to "tidy" this without measuring.

If it does matter, the fix is to split the methodology notes into a sibling file rather
than delete them, and to re-freeze a baseline deliberately.

Note the shape: `RM-2` was a parse-level defect in this file and turned out to be
cosmetic, since the fences are not functional for promptfoo. Checking *why* they might be
functional is what surfaced this, which is the more interesting question. The scout was
worth more than the repair it authorised.

**Status:** open

**Valid:** dated 2026-09-01

## RM-23 — Adjudicate the passover promote-when, whose counter its own failure mode made unincrementable

Carried forward from `docs/trackers/archive/passover-session-passover-tracker-2026-06-18.md`
(archived 2026-09-01; the move re-keyed it, so cite the path rather than the old id) so that
archiving it does not drop the one live thing in it. That passover's Next action 5 read:

> **Promote-when watch:** if a future session MISSES an active passover (≥2 occurrences),
> promote discovery from the CLAUDE.md convention to a SessionStart hook (plan §2
> non-goal). Record each miss in the session-log.

**The criterion appears to have fired, and its own recording mechanism is why nobody
noticed.** `CLAUDE.md` § *Session Passover* records that the documented discovery query
carried `{"tags":{"in":["passover"]}}` — the wrong operator — from the day it was written,
and that on 2026-08-27 it returned **0 against 5 live tagged passovers**, where `contains`
returned all of them. So every session that ran the documented query before that fix saw
"no handoffs" and proceeded normally. That is a miss, it happened more than twice, and it
was systemic rather than a lapse of attention.

The instruction was *"record each miss in the session-log."* No miss was ever recorded —
because a session that gets a clean zero has no signal that it missed anything. The
promote-when was gated on a counter that the failure mode it watches for makes
unincrementable. Worth noting as a defect in the criterion, not only in the query.

**What is owed is a decision, not an implementation.** The plan listed a SessionStart
auto-surface hook as a §2 **non-goal**, and the passover's own anti-goals say *"Do NOT add
a SessionStart auto-surface hook yet."* Options, roughly in increasing cost:

1. Treat the operator fix as the repair and close the promote-when — the misses had one
   cause, it is fixed, and the convention now works as designed.
2. Keep the convention but make a zero result legible: have the discovery step assert a
   positive control (query a tag known to exist) so an empty answer is distinguishable
   from a broken query.
3. Build the SessionStart hook, overriding the recorded non-goal.

Option 2 is the one that addresses what actually went wrong, since the failure was an
instrument reporting emptiness rather than a human forgetting to look. But this is the
user's call — the anti-goal is explicit and was written deliberately.

**Status:** open

**Valid:** conditional — a decision is recorded on options 1-3 above

## RM-24 — Two or more advisors projected together is untested — the one condition the spec says re-opens the premise

Carried forward from `docs/trackers/archive/passover-advisor-projection-eval-2026-08-27.md`
(archived 2026-09-01) — the one item in it that was open rather than merely unpushed.

The advisor-projection eval established that omitting an advisor's `Voice` and output
contract is sufficient for the model to behave as though they are absent: three arms, n=5
each, behavioural leak 0/5, and the positive control (A1 5/5) cleared so the instrument had
power. **It tested exactly one advisor.** The design spec's § *Resolved* names two or more
advisors projected together as the only condition that re-opens the question, and the
passover calls that *"where crowding-out would plausibly first appear."*

So this is not a gap in the shipped feature — `advisors:` / `fragments:` work, and the
premise is verified rather than insured, which is why the payload-header clause was
deliberately **no-shipped**. It is an untested region of the same premise, named by the
spec itself.

**Two constraints the passover records, both worth honouring:**

- **Do not re-run the existing eval to add power.** N=5 with one stimulus is what it is;
  a second identical run adds nothing its stated limits do not already concede. More power
  means a changed design — more arms, a second stimulus, two advisors — not a bigger n.
- **Eval isolation is load-bearing.** Runs use `CLAUDE_CONFIG_DIR=~/.claude-test`
  (credentials, no plugins dir) with `--strict-mcp-config` and the model pinned to
  `sonnet`. Running in a real profile loads buddy through the plugin channel and
  contaminates every arm.

And the methodological lesson that thread ended on, which applies directly to designing
this one: **for any eval whose failure signal is an absence, pre-register a
treatment-side positive control** — a second signal that goes to zero when the
intervention is inert — and check it first. The one-advisor result technically rests on
an unregistered observable (advisor-citation count, 5/5 in A2 against 0/5 in both other
arms); it came out positive so the verdict stands, but the rule as written could not have
flagged an uninformative eval. A two-advisor design should register that observable up
front. Written up as `roster-audit-session-log:W-4` addendum 2.

Prior results and the limits binding the claim: `buddy/tests/advisor-projection-eval/RESULTS.md`.

**Status:** open

**Valid:** dated 2026-09-01

## Template for new entries

```
## RM-N — <title>

<What, where, and why it matters. Name the file and the measurement.>

**Status:** open

**Valid:** dated YYYY-MM-DD
```
