---
kind: tracker
status: draft
title: Session Log — Buddy Roster Audit
tags:
- session-log
- buddy-roster
- reconnaissance
entry_prefix:
- F
- W
entry_high_water_F: 6
entry_high_water_W: 1
---

# Session Log — Buddy Roster Audit

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Copy this file to `docs/trackers/<topic>-session-log.md`
> in the active project on first reconnaissance pass. Append F-N / W-N
> entries with:
>
> ```
> artifact(action="append_entry", id="<artifact id>", id_prefix="F",
>          anchor_heading="## Template for new entries",
>          title="<one-line title>", body="**Observed:** ...")
> ```
>
> One call, one write: the server allocates the next id, formats the
> heading as `## F-N — <title>` (the only shape `link_scan` accepts as a
> definition), records the ledger's high-water mark, and stamps
> `**Valid:** dated <today>` unless your body declares a class. **Then**
> add the Index / Wins Index row, using the id the call returned — the
> indexes are the eval surface, the sections are the evidence.
>
> **Do not hand-allocate ids, and do not pre-write index rows.** A max-id
> is a fact about an instant, and a peer session in the same checkout can
> take the number between your scan and your write. Pre-written rows are
> worse: the allocator counts an id claimed by an index row, so rows
> written ahead of their sections consume the ids they name — which is why
> codescout's `statement-validity-session-log` starts at `F-2`/`W-3`
> rather than `F-1`/`W-1` (see `F-3` there).
>
> **`edit_markdown` is not the append path**, though it works at first.
> This template ships without frontmatter, so a fresh copy is directly
> editable — but once you declare `entry_prefix` to make the ledger
> guarded (which `get_guide("tracker-conventions")` tells you to do), the
> librarian guard refuses direct edits and only `append_entry` writes.
> Reach for `edit_markdown` for the prose sections and the index tables,
> never for allocating an entry.
>
> **Lifecycle:**
> - Created at the start of a multi-session work stream.
> - Appended-to across every session that touches the work.
> - Entries with `Status: open` carry forward across sessions.
> - Promotion to permanent surfaces (CLAUDE.md, ADRs, formal bug
>   trackers) happens when the entry's `Promote-when` / `Fix idea`
>   criteria fire.
> - File archived (moved to `docs/trackers/archive/`) when the work
>   stream wraps.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-08-26 | med | tracker-drift | open | A drift finding re-measured its own title; the claim that number supported was falsified and went unfiled |
| F-2 | 2026-08-26 | med | tracker-drift | open | `buddy-introspection` reports `specialists_scanned: 10/10` while the roster has grown to 12 |
| F-3 | 2026-08-26 | med | codescout-tool | fixed-verified | The reconnaissance skill's own worked exemplars use a `**Valid:**` form that `append_entry` hard-rejects (`f53aaea`; committed, not yet shipped) |
| F-4 | 2026-08-26 | med | tracker-drift | open | `T-N` is not a live namespace, so ~60 citations are silently inert — invisible to `link_scan` and to `doctor` (**corrected** same day; original claim was "dangles permanently") |
| F-5 | 2026-08-26 | med | codescout-tool | open | codescout's session-log template cites its own ledger's ids bare, so every fresh copy injects cross-repo dangling (and one wrongly-resolving) citation |
| F-6 | 2026-08-26 | med | codescout-tool | open | `link_scan` has a third citation state it never reports, and its finding arrays are silently capped at 50 — two sessions drew opposite wrong conclusions from one output |
## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-08-26 | med | Audit a drift finding by reading the whole cited claim + its tracker's live state, not the fragment the finding quotes | `VG-8` would have closed as a one-integer edit, leaving `#20`'s falsified 3×-baseline `Accept` and a `10/10` scope over a 12-specialist roster both standing | validated |
---

## Promotion status

**Audited:** <YYYY-MM-DD>, against the target surface itself — opened and read,
not recalled.

One line per `W-N` (and any `F-N` with a `Fix idea` bound for a permanent
surface). Check the **target**, not the entry: a `Promote-when` that fired is
invisible from inside the tracker, because `Status: validated` reads as healthy
either way. Record one of:

- **already promoted, no action** — quote the promoted text verbatim and name
  where it landed, so the next reader verifies instead of re-deriving.
- **UNFIRED, carried forward** — restate the criterion and the current datapoint
  count.
- **FIRED but not yet applied** — the one that leaks. Name the exact target
  surface and the exact text to add. This is an action item, not a note; set the
  entry's `Status:` to `promotion-due` so a query can find it.

> ⚠️ **Name every instance of the target, not the target's type.** This machine
> runs three Claude Code profiles (`~/.claude`, `~/.claude-sdd`,
> `~/.claude-kat`), each with its own `CLAUDE.md`. An audit that concluded
> *"not found in the user's global CLAUDE.md"* — singular — led to a promotion
> that reached one file of three on 2026-08-18. The session that found the gap
> was running on a profile **without** the rule, and applied it only because
> another profile's copy happened to be injected as project instructions. Three
> files that should be byte-identical have an md5; compare them.

> ⚠️ **For an INSTALLED artifact the target is the SERVING copy — not the repo
> source, and not the other copies.** Measured 2026-08-20: three rules promoted
> into a plugin skill were byte-identical across all three profile caches *and*
> stale against source, because the commit never bumped the version the cache is
> keyed on. Comparing the copies to each other reads **green** there — only
> comparing each copy to the claim catches it. And the session that made the edit
> is the **least representative observer**: its own reload resolved the skill from
> the repo source, so the confirming evidence sitting in front of it was evidence
> about the wrong artifact.

> ⚠️ **Anchor on a back-citation, not a verbatim quote.** A quote goes red when the
> promoted rule is legitimately reworded — a false positive produced by the
> promotion working as intended, observed 2026-08-20 when `R-89`'s bullet was
> rewritten and the tracker's stored quote had to be edited to match. The durable
> form is the promoted text citing its own entry id —
> *"(R-1 + R-7 in codescout's `docs/trackers/reconnaissance-patterns.md`.)"* — so
> verification is a `grep` for the id and survives every rewording. Keep the quote
> as a reading aid; do not make it the predicate.

Run this when the work stream wraps, **and** whenever a criterion fires
mid-stream — an audit that only happens at archive time is one that happens
after the lesson was needed. Prior art: `eduplanner-ui`
`docs/trackers/archive/calendar-insight-panel-session-log-2026-08-18.md`, whose
audit correctly caught its own `W-4` as fired-and-unapplied and named the exact
text to promote.

## Category conventions

Use a short kebab-case category to group similar frictions. Prior
sessions have used:

| Category | When to use |
|---|---|
| `codescout-tool` | Friction in a codescout MCP tool (`grep`, `read_file`, `edit_markdown`, etc.) |
| `subagent` | Subagent produced unexpected output or diverged from instructions |
| `plan-prose` | Plan document had drift vs reality (wrong file paths, fictional code, mismatched counts) |
| `architectural` | Discovered structural property of the system that the plan / docs didn't surface |
| `self-friction` | Predicted a friction that turned out to be a false alarm — recorded for transparency |
| `<language>-<library>` | Language- / library-specific footgun (`rust-serde`, `python-typing`) |
| `release-pipeline` | Deployment-time gap (release binary missing, MCP reload needed, etc.) |

Add a new category by writing it as a kebab-case string; no central registry needed.

---

## F-N entry template

Pass this block as `append_entry`'s `body` (without the `## F-N — <title>`
line — the server writes the heading from `title`). Add the matching Index
row afterwards, using the id the call returned. Do not allocate the id
yourself; see *How to use* above.

```markdown
## F-N — <one-line title>

**Observed:** <date, session task>

**When:** <what you were trying to do>

**Expected:** <what plan / docs / prior session said>

**Got:** <actual observed reality>

**Probable cause:** <one sentence>

**Workaround:** <what you did to proceed>

**Severity:** low | med | high

**Status:** open | wontfix-false-alarm | fixed-verified | mitigated | promoted-to-bug-tracker | pinned-as-eval-baseline

**Valid:** invariant | dated YYYY-MM-DD | conditional — <the event that ends it>

**Rests on:** <one durable sentence — an ADR, a decision, or the principle this
instantiates>

**Fix idea / Pointer:** <issue # in formal tracker, plan task ID, or "TBD">

---
```

## W-N entry template

Pass this block as `append_entry`'s `body`, with `id_prefix="W"` — F-N and
W-N have separate counters. A win without a **Counterfactual** is marketing
— name what would have happened without the pattern, with at least one
piece of evidence.

```markdown
## W-N — <one-line title>

**Observed:** <date, session task>

**Pattern:** <the practice that worked>

**Counterfactual:** <what would have happened without the pattern, with evidence>

**Confirming data points:** <list of session moments validating the pattern; aim for ≥2>

**Impact:** low | med | high

**Promote-when:** <criterion for graduating into permanent docs (CLAUDE.md, ADR, etc.)>

**Promoted-to:** <surface + section, one per line, line-start — omit until it lands>

**Status:** validated | promotion-due | promoted-to-permanent-docs | archived

**Valid:** invariant | dated YYYY-MM-DD | conditional — <the event that ends it>

**Rests on:** <one durable sentence — an ADR, a decision, or the principle this
instantiates>

---
```

---

## Status vocabulary

Codified so the Index column means the same thing across sessions.

### Friction statuses

| Status | Meaning |
|---|---|
| `open` | Observed, not yet resolved. Default for new entries. |
| `wontfix-false-alarm` | Initial observation was wrong; documented for transparency rather than deleted. |
| `mitigated` | Workaround in place; root cause not fully resolved. |
| `fixed-verified` | Code / process fix landed AND empirically confirmed. (`fixed` alone is too weak — verification is part of the status.) |
| `promoted-to-bug-tracker` | Moved to a formal tracker (`docs/issues/*`, `docs/TODO-*`, GitHub issue). The session log keeps the pointer; the formal tracker owns the lifecycle. |
| `pinned-as-eval-baseline` | Kept verbatim as a reference point for measuring later improvements. Do NOT close — its job is to remain comparable. |

### Win statuses

| Status | Meaning |
|---|---|
| `validated` | Pattern confirmed by ≥1 counterfactual data point. Default for entries with evidence. |
| `promotion-due` | `Promote-when` has **fired** and the text is not yet on the target surface. An action item, not a resting state. Exists because `validated` cannot distinguish "criterion not yet met" from "criterion met, nobody harvested it" — and both read as healthy, which is how a lesson sits unpromoted while the failure it describes recurs. |
| `promoted-to-permanent-docs` | Moved into CLAUDE.md, an ADR, a skill, or another permanent surface. Session log keeps the pointer — and, for a multi-instance target, names every instance it landed in. |
| `archived` | Pattern no longer load-bearing — either the underlying system changed or the discipline became automatic. |

---

## F-1 — A drift finding re-measured its own title; the claim that number supported was falsified and went unfiled

**Observed:** 2026-08-26, verifying `docs/trackers/validation-domain-coverage.md` `VG-8` against source. `VG-8` files `buddy-introspection` `#20 — security-ibex — Length 167 lines` as doc-vs-code drift on the ground that the file is now 181 lines.

**When:** Reviewing a cross-repo research handoff (eight `VG-N` entries, a coverage map, one `headroom-optimization.md` backlog edit) before accepting any of it. No edit dispatched.

**Expected (as filed):** a 14-line number drift, `Severity: low`, self-described as "the kind that compounds".

**Got (scouted reality):** `#20`'s body at `docs/trackers/buddy-introspection.md:347-355` carries three claims `VG-8` never quotes: *"Highest length of any specialist (others 47–60 lines)"*, *"Token budget roughly 3× per specialist baseline"*, and `**Fix:** Accept`. Measured today over `buddy/skills/*/SKILL.md`: the ten specialists `buddy-introspection` lists under `specialists_scanned` are **118–136** lines, so `security-ibex` at 181 is **~1.4×** baseline, not 3× — and `codescout-pika` at **316** exceeds it outright, so "highest length of any specialist" is now false. `#20`'s *disposition* — accept the length because it is a justified 3× outlier — rests on a comparison that no longer holds.

**Probable cause:** the drift check re-measured the one number the finding put in its **title**. A title carries the cheapest datum to re-measure and the least of the reasoning; the load-bearing claims sat four lines below it and were never opened.

**Workaround:** widen `VG-8` from "the number moved" to "the comparison behind the disposition is falsified — re-open `#20`, do not re-stamp its line count", and raise its severity above low.

**Severity:** med — as filed, `VG-8` closes by editing one integer, leaving an `Accept` disposition standing on arithmetic now wrong by a factor of two. The next reader inherits a live wrong conclusion from an entry marked resolved. Not high: nothing ships from `#20`, and the roster is not load-bearing code.

**Status:** open — `VG-8` not yet widened; `#20` not yet re-opened.

**Valid:** dated 2026-08-26

True of `buddy/skills/` at plugin version 0.9.1; re-verify after any specialist rewrite.

**Rests on:** `buddy-introspection.md`'s own `specialists_scanned: 10/10` list, which defines the 118–136 baseline population; and `#20`'s body text, read this session rather than recalled.

**Fix idea / Pointer:** `VG-8` in `docs/trackers/validation-domain-coverage.md`; `#20` at `docs/trackers/buddy-introspection.md:347`. Cite `W-1` (this log) when widening.

## F-2 — buddy-introspection reports `specialists_scanned: 10/10` while the roster has grown to 12 — a complete-looking audit with a stale denominator

**Observed:** 2026-08-26, same verification pass as `F-1`, while establishing the baseline population `#20`'s "others 47–60 lines" was measured against.

**When:** Reading `docs/trackers/buddy-introspection.md` § Live state to check whether `security-ibex` is still the longest specialist.

**Expected:** a roster audit whose scope matches the roster.

**Got (scouted reality):** `specialists_scanned: 10/10` at `last_updated: 2026-05-15`, enumerating ten specialists. `buddy/skills/` holds **twelve**. `codescout-pika` (316 lines — the largest file on the roster, and `VG-7`'s own top trim candidate) and `prompt-hamsa` (158) appear nowhere as auditees: `grep -c 'prompt-hamsa' docs/trackers/buddy-introspection.md` returns 0, and `hamsa` appears there only as the *auditor* (the H1–H8 heuristics). Two specialists have never been audited on the prompt-craft axis at all.

**Probable cause:** `N/N` notation encodes progress against a population captured at write time, and nothing re-derives the denominator. `10/10` is indistinguishable from complete at a glance, so the tracker reports full coverage of a roster it no longer covers.

**Workaround:** none applied. The legible fix is an explicit `specialists_unaudited:` key (or `10/12`) so the gap survives a skim without anyone recounting `buddy/skills/`.

**Severity:** med — every `S-N` row's `Applies to (N/10)` count understates by an unknown amount, `VG-7` nominates the roster's largest file for a trim without noting it is also unaudited, and `active-plan.md` `T-35` (quarterly hamsa sweep, due 2026-08-15, eleven days overdue at time of writing) has no signal that its scope grew by two.

**Status:** open

**Valid:** dated 2026-08-26

True of `buddy/skills/` at plugin version 0.9.1 — twelve specialist directories, ten named in `specialists_scanned`.

**Rests on:** `buddy-introspection.md` § Live state, read this session; and a direct listing of `buddy/skills/`, not the plugin cache.

**Fix idea / Pointer:** `docs/trackers/buddy-introspection.md` § Live state; feeds `active-plan.md` `T-35`. Related to `F-1` — same tracker, same staleness, different mechanism (a falsified supporting claim vs. a moved population).

## F-3 — The reconnaissance skill's own worked exemplars use a `**Valid:**` form that `append_entry` hard-rejects

**Observed:** 2026-08-26, first `append_entry` call of this session, writing `F-1` into this log.

**When:** Immediately after the skill instructed *"Pattern your new entries on these, not the bare template."*

**Expected (per the skill):** `codescout-companion/skills/reconnaissance/SKILL.md`'s F-N and W-N worked exemplars both close with a validity line carrying a trailing qualifier — e.g. `**Valid:** dated 2026-05-18 — true of \`RecoverableError\`'s field/method shape at that commit; re-verify if \`src/tools/core/types.rs\` changes.`

**Got (scouted reality):** the server rejects that form outright:

```
`**Valid:** dated 2026-08-26 — true of ... ` is not an ISO date
hint: Use `dated YYYY-MM-DD`. The three forms are:
      **Valid:** invariant | dated YYYY-MM-DD | conditional — <event>
```

Reproduced twice — once with my own wording, once with the exemplar's wording verbatim — so it is the trailing prose the validator refuses, not any particular content. The accepted form is a bare `**Valid:** dated YYYY-MM-DD`; a qualifier has to move to a following line or into `**Rests on:**`.

**Probable cause:** the validator parses the whole line after `**Valid:**` as the class token, while the em-dash-qualifier convention was documented in prose (the skill's exemplars, and `get_guide("tracker-conventions")`'s `conditional — <event>` form, which *does* take trailing text) without a parser that accepts it for `dated`.

**Workaround:** bare date on the `**Valid:**` line; qualifier on the next line. Applied to `F-1`, `F-2` and `W-1` in this log.

**Severity:** med — costs one rejected round-trip on the first entry of every session that follows the skill's own instruction to copy the exemplars. Silent-failure risk is nil (it errors loudly and the hint names the fix), which is what keeps it below high.

**Status:** fixed-verified — skill-side fix applied 2026-08-26, `main` `f53aaea`, patch-id `5576ef7bc111539ce56ac0b7170cfbe631e25e9c`. Both exemplars now use the bare-date form, and Phase 3 states the `dated`-vs-`conditional` asymmetry at the point the stamp is described. Verified by a class-wide grep across `codescout-companion/skills/`, `buddy/skills/` and `sdd/` — **with the regex first checked against a known-positive line**, so the zero is evidence rather than an untested absence. `./tests/run-all.sh` 16/16 green; no test pins the edited strings.

**NOT LIVE.** No version bump yet — more refactoring is queued for the same release — so every profile cache still serves the pre-fix copy. Per the freshness law in Phase 1, the honest claim for this edit is *committed*, not *shipped*. The server-side option (accept `dated <date> — <prose>`) was deliberately not taken: it widens a currently-strict grammar and the boundary was never established.

**Valid:** dated 2026-08-26

Observed against the codescout build serving this session.

**Rests on:** two rejected `append_entry` calls this session, one using the exemplar's own wording.

**Fix idea / Pointer:** `codescout-companion/skills/reconnaissance/SKILL.md` § Worked exemplars (both F-N and W-N blocks). Same class as `repo-hygiene-session-log:F-2` — a reconnaissance template whose own example does not survive first contact with the tool that consumes it.

## W-1 — Auditing a drift finding by reading the whole cited claim, not the fragment the finding quotes

**Observed:** 2026-08-26, verifying a cross-repo research handoff before accepting it — eight `VG-N` entries in a new `docs/trackers/validation-domain-coverage.md`, a 14-row coverage map, and one appended backlog item in `buddy/docs/trackers/headroom-optimization.md`.

**Pattern:** When auditing a **doc-vs-code drift finding**, re-read the whole cited claim at its source, plus the live-state block of the tracker it lives in — not the fragment the finding quotes. A drift entry names the datum that moved; the claim that datum *supports* sits one paragraph away, and it is the claim, not the datum, that carries the disposition.

**Counterfactual:** `VG-8` quotes exactly one thing from its target: `#20`'s heading, `security-ibex — Length 167 lines`. Re-measuring only that integer confirms the drift (181 today) and closes the entry. Reading `#20`'s four-line body instead surfaced that *"others 47–60 lines"* and *"roughly 3× per specialist baseline"* are now false — the audited ten measure 118–136, and `codescout-pika` at 316 outweighs `security-ibex` outright — so `#20`'s `Fix: Accept` rests on falsified arithmetic (`F-1`). Reading the same tracker's § Live state, two screens above the entry, surfaced `specialists_scanned: 10/10` against a roster of twelve (`F-2`). Both survive a check that re-measures the quoted number, and both change what the overdue `T-35` sweep has to cover. Cost of not doing it: one integer edited, two live wrong conclusions left standing in a ledger marked resolved.

**Confirming data points:**
1. `F-1` (this log) — falsified supporting comparison, found in the cited entry's body.
2. `F-2` (this log) — stale population denominator, found in the cited entry's tracker-level live state. Same mechanism, different surface, same session.

**Impact:** med — converts a one-integer cleanup into two re-opened findings, and prevents a stale audit from being re-blessed by the check that was supposed to test it.

**Promote-when:** a third instance where auditing a drift finding's *context* rather than its *quoted datum* changes the disposition, ideally outside this repo's tracker family. At three datapoints this is craft-shaped, not project-shaped — the routing test in the skill's *Promotion routing* section sends it to `SKILL.md` Phase 1, alongside the existing "a proposed fix — and equally a prohibition — is a claim about CURRENT STATE" bullet, which it generalises from *proposals* to *filed findings*.

**Status:** validated — two datapoints this session; promote-when threshold not yet reached.

**Valid:** dated 2026-08-26

Both datapoints measured against `buddy/skills/` at plugin version 0.9.1, source rather than plugin cache.

**Rests on:** `F-1` and `F-2`, same session — this win is their shared counterfactual, not independent evidence.

## F-4 — `T-N` is not a live namespace, so ~60 citations are silently inert — invisible to `link_scan` and to `doctor`

> **Corrected 2026-08-26, same day as filing.** This entry originally claimed *"every `T-N`
> citation in the repo dangles permanently"* and prescribed reading `dangling_by_source` to
> see it. That reproduction shows the **opposite** of what was claimed. The error is
> recorded rather than overwritten because its mechanism is the reusable part — see
> `roster-audit-session-log:F-6` for the tooling gap and
> `reconnaissance-patterns:R-4` for the reasoning failure.

**Observed:** 2026-08-26, running `librarian(action="link_scan")` to verify that `F-1`,
`F-2`, `F-3` and `W-1` introduced no broken citations.

**When:** Post-write verification of my own entries; then again on re-reading a peer
session's report, which asserted the opposite conclusion from the same instrument.

**Expected (as originally filed):** `T-35` has no heading definer anywhere, therefore every
`T-N` citation dangles.

**Got (scouted reality):** `T-N` citations are neither resolved nor reported. A prefix
becomes a live namespace only when at least one artifact **defines** a token with it via a
`<h*> <ID> — <title>` heading. `T` has zero definers repo-wide, so `link_scan` never treats
`T-35` as a citation candidate at all.

Measured across the four namespaces in play:

| Prefix | Definers | Behaviour |
|---|---|---|
| `U` | `## U-1 — …` ×5 in `codescout-usage-audit-session-log.md` | live → `U-28` **dangles** |
| `D` | `### D-1..D-7 — …` in `active-plan.md` | live, all defined → `D-6`/`D-7` **resolve** |
| `S` | `#### S-1..S-6 — …` in `buddy-introspection.md` | live, all defined → `S-5` **resolves** |
| `T` | **none, at any heading level** | **inert** — citation invisible |

Two independent confirmations: `docs/issues/2026-08-26-active-plan-t-n-row-only-uncitable.md`
cites eleven `T-N` tokens and reports exactly **1** dangling (`R-91`, quoted from the
guide's own example table); this log cites `T-35` nine times and its 4 dangling are
precisely `R-7`, `R-89`, `W-3`, `W-4`.

Note heading **level** is irrelevant — `### D-6 — …` and `#### S-1 — …` both define.
`get_guide("tracker-conventions")`'s `### A-9 Addendum` counter-example fails on the missing
dash, not the level.

**Probable cause of the original error:** the guide sentence I cited — *"a table row defines
no token"* — is **true**, and `active-plan.md` genuinely defines nothing. What was
unwarranted was the second premise: that a citation to an undefined token necessarily
dangles. That is a claim about the resolver's state space, and I asserted it from a model of
the resolver rather than from its output. The `dangling` array with its `raw` fields was
already in the buffer I had open.

**Workaround:** none on the citing side, and none is available — there is nothing to work
around, because nothing is reported.

**Severity:** med — unchanged, but for a different reason. Inert is worse than dangling in
one specific respect: a dangling citation is reported and generates a worklist, while an
inert one is reported nowhere. `librarian(action="doctor")`'s `entry_without_definition`
cannot fire either, because there are no entries to lack definitions. ~60 cross-file
references to `active-plan.md`'s tasks produce no edge and no warning.

**Status:** open

**Valid:** dated 2026-08-26

True of `docs/trackers/active-plan.md` at commit `2d6cdbe` — 38 task rows, zero `T-N`
headings at any level.

**Rests on:** the four-namespace measurement above, taken from `link_scan`'s own output
rather than from the resolver's documented rule.

**Fix idea / Pointer:** give each task a `## T-N — <title>` heading and keep the table —
`get_guide("tracker-conventions")` explicitly permits both.

**The conversion is all-or-nothing, and the original entry had the reason backwards.** It
prescribed "headings first, then declare `entry_prefix`", which is still correct *for the
guard*. But the citation consequence inverts: **the moment the first `## T-N — …` heading
lands, `T` becomes a live namespace, and every `T-N` citation whose task does not yet have a
heading flips from inert to dangling.** A partial conversion is strictly worse than none.
All 38 must land in one pass, then `entry_prefix: T` + `entry_high_water_T: 38`, then
`link_scan(write=true)`.

`active-plan.md` carries **no frontmatter at all** (it opens on its `#` title) yet is
catalogued as `kind: tracker, status: active` by the classifier — so there is no frontmatter
block to add the declaration to, and one has to be created.
## F-5 — codescout's session-log template cites its own ledger's ids bare, so every fresh copy injects cross-repo dangling citations

**Observed:** 2026-08-26, same `link_scan` verification pass as `F-4`. Of the four dangling citations this log introduced, three were `T-35` (`F-4`); the fourth, plus several ambiguous ones, came from the template's own prose — not from any entry I wrote.

**When:** Immediately after copying `/home/marius/work/claude/codescout/docs/templates/session-log.md` to `docs/trackers/roster-audit-session-log.md` per the skill's Phase 3 instruction.

**Expected:** template boilerplate is inert — prose, tables and worked examples that carry no live citations into the copying repo.

**Got (scouted reality):** the template's § Promotion status and its How-to blockquote cite **codescout's** ledger entries bare:

- line 44 — `` `F-2`/`W-3` `` (codescout's `statement-validity-session-log`)
- line 120 — `` `R-89` ``
- line 123 — `` R-1 + R-7 ``
- line 131 — `` `W-4` ``

Bare tokens resolve against the *copying* repo. Here `R-1` happens to hit this project's own `reconnaissance-patterns.md` R-1 — a **wrong** resolution, silently — while `R-7`, `R-89` and `W-4` dangle, and `F-2`/`W-3` land in the ambiguity pool shared by eleven session logs. The qualified form the guide provides for exactly this (`codescout:R-89` — *"a qualifier naming no file in this repo is still a cross-repo reference: reported, never turned into an edge"*) is not used.

**Probable cause:** the template was written inside codescout, where those citations resolved correctly, and nothing tested it from the outside. A template is the one document whose citations are always read in a different repo than the one they were written in.

**Workaround:** none applied to the copy — rewriting the template's own prose in every downstream copy is the wrong side of the fix.

**Severity:** med — one wrong-resolution (`R-1` binding to an unrelated local entry) plus three dangling and two ambiguous, per fresh copy, in every repo that follows the skill. The wrong resolution is the bad one: it produces a `cites` edge that is confidently incorrect rather than reported as broken.

**Status:** open — needs a template-side fix.

**Valid:** dated 2026-08-26

Observed against the template at `/home/marius/work/claude/codescout/docs/templates/session-log.md`.

**Rests on:** `get_guide("tracker-conventions")` § *Citing an entry — bare, or qualified*, which specifies `<repo>:<ID>` for exactly this case; and the four template line numbers above, read this session.

**Fix idea / Pointer:** qualify every id in `docs/templates/session-log.md` as `codescout:<ID>`. Same class as `repo-hygiene-session-log:F-2` and `F-3` (this log): three separate defects now, all of the form *reconnaissance boilerplate that does not survive being copied into another repo*. That recurrence is itself the argument for a test that copies the template into a scratch repo and runs `link_scan` on it.

## F-6 — link_scan has a third citation state it never reports, and its finding arrays are silently capped — two sessions drew opposite wrong conclusions from the same output

**Observed:** 2026-08-26. Two sessions read the same `librarian(action="link_scan")` output about `T-N` citations and reached opposite conclusions. Both were wrong, and the report gave neither of them the means to notice.

**When:** Re-reading a peer session's verification block against current state, after `F-4` had already been filed on the opposite reading.

**Expected:** `link_scan`'s report distinguishes resolved from broken, and its finding arrays enumerate the broken ones.

**Got (scouted reality):** two independent gaps.

**1 — The unreported third state.** A citation can be *resolved*, *dangling/ambiguous*, or **inert**: the prefix has zero definers repo-wide, so the token is never a candidate and appears in no bucket. `T-N` is inert here (~60 cross-file citations). Nothing surfaces it:

- `link_scan` reports `dangling`, `ambiguous`, `cross_repo` — inert is none of these, and `citations: 469` does not decompose in a way that reveals the shortfall.
- `librarian(action="doctor")`'s `entry_without_definition` and `ledger_defines_nothing` both key off *entries*. `active-plan.md` declares no `entry_prefix` and defines no entries, so neither check has anything to iterate.

The result is a namespace that reads healthy from every angle while carrying zero live edges.

**2 — The silently capped arrays.** `ambiguous` and `dangling` are truncated to 50 elements against populations of 81 and 70. The envelope discloses this only obliquely — `arrays: ambiguous[50], dangling[50]` in the summary, contradicted by `counts.ambiguous: 81` — and there is no per-array `truncated` flag, though `scan_truncated: false` exists for the artifact sweep. The complete census is `ambiguous_by_source` / `dangling_by_source`, which are per-file maps and so cannot answer "which tokens".

**How the two combined.** The peer session reasoned: *"the arrays contain only F-N/W-N/R-N/U-28 — no T-\*, D-\*, or S-5, so T-35/T-37/D-6 all resolved."* Gap 2 makes the premise unsound (absence from a 50-element sample of 70 proves nothing) and gap 1 makes the conclusion wrong (there was a third state). It landed on one correct call — `D-6` genuinely does resolve, via `### D-6 — …` — and one incorrect one, by luck rather than method. `F-4` erred in the other direction from a model of the resolver rather than its output.

**Probable cause:** the report is shaped around the two states that have remedies. A prefix nobody has ever defined is not a *broken* citation in the resolver's terms — it is not a citation at all — so there is no natural place for it in a report organised by breakage.

**Workaround:** read `*_by_source` for census, and resolve a **known-state token** before trusting any categorical claim. One call settles it: `U-28` (known undefined, expect dangling) and `D-6` (known defined, expect resolved) alongside the token in question. Three tokens, three expected states — the mismatch names the missing state immediately.

**Severity:** med — no silent data loss, but it produced two confidently wrong findings in one day on one namespace, and one of them was filed as an issue before correction. Not high: the fix is additive and nothing depends on the inert citations today.

**Status:** open — filed upstream as a codescout issue; see Fix idea.

**Valid:** dated 2026-08-26

Measured against the codescout build serving this session; `citations: 469`, `ambiguous: 81`, `dangling: 70`, arrays capped at 50.

**Rests on:** the four-namespace measurement in `roster-audit-session-log:F-4` (`U`/`D`/`S` live, `T` inert), and the two-session divergence described above.

**Fix idea / Pointer:** a `doctor` check — `cited_prefix_with_no_definer`: any prefix with ≥1 citation and 0 definers, reported with the citation count and the citing files. That converts the invisible state into a worklist row and is the only remedy either session could not have missed. Secondarily, a per-array `truncated: true` flag on `link_scan`'s findings. Both belong to codescout, not this repo. Reasoning-side counterpart: `reconnaissance-patterns:R-4`.

## Template for new entries

<!-- New F-N / W-N entries land above this line. This heading is the anchor:

     artifact(action="append_entry", id="<artifact id>", id_prefix="F",
              anchor_heading="## Template for new entries",
              title="<one-line title>", body="**Observed:** ...")

     The server allocates the id, writes `## F-N — <title>` at the ledger's
     own level, records the high-water mark and stamps `**Valid:** dated
     <today>` — one write. Then add the Index / Wins Index row with the id
     it returned. Do not hand-allocate; do not pre-write the row. -->
