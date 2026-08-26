---
id: a1bbcbff8e035b6c
kind: bug
status: fixed
title: '`T-N` is not a live namespace, so active-plan.md''s ~60 incoming citations are silently inert — invisible to link_scan and to doctor'
tags:
- tracker-drift
- librarian
- link-graph
- active-plan
- roster-audit
closed: 2026-08-26
opened: 2026-08-26
severity: med
unverified: 'The all-or-nothing constraint remains DERIVED, not demonstrated: the prescribed scratch-copy trial (add one T-N heading, watch the other 37 flip to dangling) was never run, because converting all 38 atomically made it unnecessary and running it would have been the only way to actually enter the dangling state. Also unfixed: the upstream doctor check cited_prefix_with_no_definer, which is the half that generalises. And no per-task completion status was derived — the new sections carry row fields only.'
---

## Summary

> **Corrected 2026-08-26, same day as filing.** This issue originally claimed that
> `active-plan.md`'s ~60 incoming `T-N` citations **dangle**, and prescribed reading
> `link_scan`'s `dangling_by_source` to see it. That reproduction shows the opposite. The
> real behaviour is a third state neither the report nor `doctor` surfaces. Original
> reasoning and its failure are preserved in `roster-audit-session-log:F-4`; the tooling gap
> is `roster-audit-session-log:F-6`; the reasoning failure is `reconnaissance-patterns:R-4`.

`docs/trackers/active-plan.md` owns the `T-N` task namespace (T-1..T-38) but defines every
task as a **table row**. `link_scan` binds a token to a `<h*> <ID> — <title>` heading and to
nothing else, so `T` has **zero definers repo-wide**.

The consequence is not broken citations. It is *no* citations: a prefix with no definers is
never a resolution candidate, so `T-35` is neither resolved nor reported. ~60 cross-file
references from seven files produce no edge, no warning, and no worklist row.
## Symptom (Effect)

The link graph has **no edge** between the plan and any tracker that depends on it, and
nothing reports the absence.

`artifact(action="graph")` and `librarian(action="context", anchor_id=…)` both read that
graph, so neighbourhood packing silently omits the plan for every task-level query.
`eval-bringup.md` — whose stated purpose is *"Subset focus of active-plan Phase 0 (T-6..T-11
specifically)"* — cites 22 tasks and is linked to none of them.

`T-N` occurrences, counted 2026-08-26:

| File | `T-N` occurrences |
|---|---:|
| `active-plan.md` (self) | 136 |
| `eval-bringup.md` | 22 |
| `roster-audit-session-log.md` | 15 |
| `fixture-expansion.md` | 10 |
| `INDEX.md` | 6 |
| `validation-domain-coverage.md` | 5 |
| `buddy-introspection.md` | 1 |
| `reconnaissance-patterns.md` | 1 |

Inert is worse than dangling in one specific respect: a dangling citation is reported and
generates a worklist row, so someone eventually fixes it. An inert one is reported nowhere.
## Reproduction

```
grep -c '^#\+ T-' docs/trackers/active-plan.md              # → 0   (definitions)
grep -c '| T-'    docs/trackers/active-plan.md              # → 38  (rows)
grep -rn '^#\{1,6\} *T-[0-9]\+ *[—–-]' --include='*.md' .    # → (nothing, any level, repo-wide)
```

Then run `librarian(action="link_scan")` **with a positive control** — without one the output
is misread in either direction:

| Token | Known state | Expected in report |
|---|---|---|
| `U-28` | cited, no definer, prefix live (`## U-1 — …` exists) | **dangling** |
| `D-6` | defined at `active-plan.md:144` (`### D-6 — …`) | **resolved**, no report |
| `T-35` | cited 9×, prefix has no definer anywhere | **absent from every bucket** |

The third row matching neither expectation is the finding.

**Do not read the `dangling` / `ambiguous` arrays as a census** — they are capped at 50
against populations of 70 and 81, with no per-array `truncated` flag. Use
`dangling_by_source` / `ambiguous_by_source` for completeness. Inferring from absence in the
arrays is how the opposite wrong conclusion gets reached; see
`roster-audit-session-log:F-6`.
## Environment

- `claude-plugins` @ `2d6cdbe`
- `docs/trackers/active-plan.md`, 38 task rows across 4 phases

## Root cause

A prefix becomes a live namespace only when at least one artifact **defines** a token with
it via a `<h*> <ID> — <title>` heading. Measured across the four namespaces in play:

| Prefix | Definers | Behaviour |
|---|---|---|
| `U` | `## U-1 — …` ×5 in `codescout-usage-audit-session-log.md` | live → `U-28` dangles |
| `D` | `### D-1..D-7 — …` in `active-plan.md` | live, all defined → resolves |
| `S` | `#### S-1..S-6 — …` in `buddy-introspection.md` | live, all defined → resolves |
| `T` | **none, any level** | **inert** — citation invisible |

Heading **level** is irrelevant: `### D-6 — …` and `#### S-1 — …` both define.
`get_guide("tracker-conventions")`'s `### A-9 Addendum` counter-example fails on the missing
dash, not the level. Note `active-plan.md` defines `D-N` correctly in the same file where it
defines no `T-N` — the defect is local to the task table, not to the file.

`active-plan.md` predates the entry-definition rule and reads well as a 38-row table.
Nothing in it is wrong; it simply is not addressable by machinery that grew up around it.
It also carries **no frontmatter at all** (it opens on its `#` title) yet is catalogued as
`kind: tracker, status: active` by the classifier — so there is no frontmatter block to
declare `entry_prefix` in, and one has to be created.

The compounding part is the convention layered on top.
`docs/trackers/validation-domain-coverage.md` § Maintenance instructs authors to file work
as `T-N` in `active-plan.md` and cite it — correct about ownership, and it manufactures an
invisible reference every time anyone complies.
## Evidence

Two independent confirmations that `T-N` is inert rather than dangling:

1. **This issue file itself** cites eleven `T-N` tokens (`T-1`×3, `T-6`, `T-11`, `T-35`×3,
   `T-38`×3) and `dangling_by_source` reports exactly **1** for it — which is `R-91`,
   quoted from the guide's own example table. If `T-N` were scanned, this file alone would
   show five unique dangling tokens.
2. **`roster-audit-session-log.md`** cites `T-35` nine times, `T-1` three times, `T-38`
   three times, and its 4 dangling are precisely `R-7`, `R-89`, `W-3`, `W-4` — the four
   undefined tokens in prefixes that *are* live.

Across the sampled 100 report entries (50 ambiguous + 50 dangling) the `raw` tokens are
exclusively `F-N`, `R-N`, `W-N` and one `U-28`. No `T-*`, `D-*`, `S-*` or `VG-*` appears —
but for `D`/`S`/`VG` that is because they resolve, and for `T` because it is never
considered. **The same absence, two different causes** — which is precisely why the absence
alone supports no conclusion.

The governing rule, from `get_guide("tracker-conventions")` § *One entry format, never two*:
*"a ledger whose entries live only in rows has entries that nothing can cite, ever."* True
here at 38 of 38 — the guide's sentence is correct; what does **not** follow from it is that
the citations dangle.
## Fix

Give each task a `## T-N — <title>` heading and **keep the table**. The guide explicitly
permits both: *"Keeping a rendered row table in addition to headings is fine — a table is a
good reading surface."*

**The conversion is all-or-nothing.** The moment the first `## T-N — …` heading lands, `T`
becomes a live namespace and every `T-N` citation whose task does **not** yet have a heading
flips from inert to dangling. A partial conversion is strictly worse than none: it trades
~60 silent references for ~60 reported breakages plus a half-built ledger. Sequence:

1. Add all 38 `## T-N — <title>` headings in **one** pass, keeping the table.
2. Create a frontmatter block (there is none today) with `kind: tracker`, `status: active`,
   `entry_prefix: T`, `entry_high_water_T: 38`.
3. `librarian(action="link_scan", write=true)` — ~60 inert references become live edges.
4. Re-run with the positive control from § Reproduction and confirm `T-35` now resolves.

Order matters twice over: declaring `entry_prefix` guards the file against `edit_markdown`,
so the 38 insertions must precede step 2; and steps 1–2 must not be split across sessions,
or the repo sits in the dangling state in between.

Leave `validation-domain-coverage.md` § Maintenance as written — it becomes correct once the
definitions exist.

### Applied 2026-08-26 — all four steps, in the prescribed order

1. **38 `#### T-N — <title>` headings added in one `edit_markdown` pass**, tables kept, under
   a new `## Task definitions (T-1 … T-38)` section.
2. **`entry_prefix: T` + `entry_high_water_T: 38`** declared afterwards — and the ordering
   warning above proved real, not theoretical: the very next `read_markdown` on the file was
   refused with *"a ledger — it declares an entry_prefix"*. Declaring first would have locked
   out the tool doing the insertions.
3. **`link_scan(write=true)`** — entry edges derived **120 → 172**, `prefix_conflicts: 0`,
   `edges_missing: 0`, `edges_stale: 0`.
4. **Positive control run, and it mattered.** "No `T-` tokens in the dangling array" is
   *not* evidence of resolution — inert tokens are absent from that array too, which is this
   issue's entire subject. The real check was reading the edges: `D-1 → T-1/T-5/T-11/T-29/T-34`,
   `D-7 → T-7/T-8`, `T-26 → T-27`, `T-34 → T-33`, and outgoing `T-23 → buddy-specialists-hamsa-introspection-audit:S-2`.
   Live, attributed, bidirectional edges — the namespace resolves.

**Two pre-checks first, since a partial pass is worse than none.** Cited range is exactly
`T-1`…`T-38` with no gaps and nothing above 38, so no citation could be stranded above the
converted range. And zero rival `^#+ *T-[0-9]+` definers repo-wide — where the first answer
was a bare `0` carrying a warning that it had skipped `.buddy/`, `.claude/`, `.github/` and
seven more hidden roots; re-running with `include_hidden=true` is what turned that zero into
evidence.

**Scope held deliberately:** no per-task completion status was minted. The phase tables and
History assert plenty, and copying them would have written at least one falsehood —
`f97f2a4`'s subject names `T-12..T-22`, but `T-14` (reframe Method 4 as "AAA or GWT") is not
in `testing-snow-leopard`; step 4 still reads *"One arrange / act / assert per test"* and
`#10` still reads `open`. A commit subject naming a range is not evidence the range shipped.

**Upstream, and the higher-leverage half:** a `doctor` check — `cited_prefix_with_no_definer`
(any prefix with ≥1 citation and 0 definers, reported with count and citing files). That
makes this class of defect impossible to miss anywhere, rather than fixing one instance.
Belongs to codescout; tracked as `roster-audit-session-log:F-6`.
## Tests added

None. `librarian(action="doctor")` already reports `entry_without_definition` and
`ledger_defines_nothing` per artifact — this issue is a manual read of what that check
would surface, and wiring it into a gate is the durable fix rather than a test written here.

## Workarounds

None — and unlike a dangling citation there is nothing to work *around*, because nothing is
reported. Prose citing a task should name it as *"`active-plan.md`'s T-35 row"* so a human
can find it by hand; the token will not resolve either way.
## References

- `docs/trackers/active-plan.md` — the ledger; 38 rows, 0 `T-N` headings, no frontmatter
- codescout `get_guide("tracker-conventions")` § *One entry format, never two*, § *Entry headings*
- `docs/trackers/validation-domain-coverage.md` § Maintenance — the convention that routes work into the namespace
- `docs/trackers/eval-bringup.md` — heaviest cross-file citer (22), linked to none of them
- `roster-audit-session-log:F-4` — the reconnaissance entry, and the record of this issue's original wrong mechanism
- `roster-audit-session-log:F-6` — the tooling gap: `link_scan`'s unreported third state + silently capped arrays
- `reconnaissance-patterns:R-4` — the reasoning failure: positive-control law loaded and still missed
