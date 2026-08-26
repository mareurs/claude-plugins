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
entry_high_water_F: 13
entry_high_water_W: 5
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
| F-3 | 2026-08-26 | med | codescout-tool | fixed-verified | The reconnaissance skill's own worked exemplars use a `**Valid:**` form that `append_entry` hard-rejects (`f53aaea`, shipped in codescout-companion 1.16.17) |
| F-4 | 2026-08-26 | med | tracker-drift | fixed-verified | `T-N` is not a live namespace, so ~60 citations are silently inert — invisible to `link_scan` and to `doctor` (**corrected** same day; original claim was "dangles permanently") |
| F-5 | 2026-08-26 | med | codescout-tool | open | codescout's session-log template cites its own ledger's ids bare, so every fresh copy injects cross-repo dangling (and one wrongly-resolving) citation |
| F-6 | 2026-08-26 | med | codescout-tool | open | `link_scan` has a third citation state it never reports, and its finding arrays are silently capped at 50 — two sessions drew opposite wrong conclusions from one output |
| F-7 | 2026-08-26 | med | release-pipeline | fixed-verified | `release.sh` repoint + sanity loop + version-bump tracker all read install-record element `[0]`; release reported green over a stale sibling (`ce83dfd`) |
| F-8 | 2026-08-26 | med | tracker-drift | fixed-verified | `VG-7`'s success ratio is invariant under relocation — the exact fix it prescribes cannot move it; headroom 2b re-scoped (`0fd8eb1`) |
| F-9 | 2026-08-26 | med | tracker-drift | fixed-verified | A tracker's `Status: open` was copied into the passover as pending work; `#21`'s fix shipped three months earlier in `f97f2a4` — executing the handoff would have added a *second* LLM sub-section |
| F-10 | 2026-08-26 | med | release-pipeline | fixed-verified | Marketplace registrations drifted cross-profile in two files the parity gate never read — and the cross-profile pointer was **hiding** a 3-month-stale local clone of an enabled plugin (`ce83dfd`→ this commit) |
| F-11 | 2026-08-26 | med | eval-design | fixed-verified | The scenario built to score `R-4` measured **tautological** (treat 3/3, ctrl 3/3, Δ+0.00) — naming the instrument by path let base competence read the script instead of probing it. Records corrected same evening |
| F-13 | 2026-08-26 | high | eval-design | **The skill never loaded in three of four instrument scenarios**, so their "treatment" arms were controls. Adding the clause that activates it flips the *control* 0/3 → 3/3 — activation IS the treatment, and this harness cannot separate them. Corrects `F-11`, `F-12`, `W-3` |
| F-12 | 2026-08-26 | high | eval-design | fixed-verified | **Second design also tautological — and the control arm probed unprompted.** All 3 no-skill runs built a known-answer probe. Two designs, six control runs: the behaviour `R-4` teaches is base competence, so this harness cannot measure it |
## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-08-26 | med | Audit a drift finding by reading the whole cited claim + its tracker's live state, not the fragment the finding quotes | `VG-8` would have closed as a one-integer edit, leaving `#20`'s falsified 3×-baseline `Accept` and a `10/10` scope over a 12-specialist roster both standing | validated |
| W-3 | 2026-08-26 | high | **Screen a candidate law by asking whether the CONTROL fails, not by measuring a delta** — one arm, not two | Two paired runs on `R-4` returned nothing measurable; single-arm screens settled `R-5` (promote) and `R-6` (do not) for ~$1 total | **promoted-ready — promote-when FIRED**: four screens, three verdicts, both directions demonstrated |
| W-2 | 2026-08-26 | med-high | Prove the instrument against a known-positive before believing its verdict — one control per state it can report | Three claims would have shipped as verified: a regex zero, a push-gate checker's green, and a metric read after the fix instead of against it | validated (promote-when fired → `reconnaissance-patterns:R-4`, shipped `f53aaea`) |
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

**Status:** fixed-verified

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
### Fixed 2026-08-26 — all 38 in one commit, and the pre-checks the all-or-nothing rule demands

`active-plan.md` gained a `## Task definitions (T-1 … T-38)` section with 38
`#### T-N — <title>` definers. The five phase tables are kept as the plan's working
surface; the headings are what make the ids reachable.

**Two pre-checks ran first, because a partial conversion is strictly worse than none** —
the first `T-N` heading makes `T` live and flips every unconverted citation from inert to
dangling:

1. **Cited range** — exactly `T-1`…`T-38`, no gaps, nothing above 38. Had anything cited
   `T-39+`, converting 1–38 would have created dangling citations that did not exist before.
2. **No rival definer** — zero `^#+ *T-[0-9]+` headings anywhere in the repo, hidden
   directories included. The `grep` tool's first answer was a bare `0` **with a warning that
   the zero excluded `.buddy/`, `.claude/`, `.github/` and seven more roots**; re-running with
   `include_hidden=true` is what made it evidence. That warning is `W-2` built into a tool.

**Result:** `link_scan` — entry edges derived 120 → 172, `prefix_conflicts: 0`,
`edges_missing: 0`, `edges_stale: 0`, and **zero `T-` tokens in the dangling, ambiguous or
cross-repo arrays**. All 218 `T-N` citations across 13 files now resolve.

**One thing deliberately not done: no per-task completion status was minted.** Each entry
carries its row's own fields, and the section says so. The temptation was real — five phase
tables plus a History section between them assert plenty — and acting on it would have
written at least one false claim: `f97f2a4` is titled *"Phase 1 cheap fixes per
buddy-introspection T-12..T-22"*, but `T-14` (reframe `testing-snow-leopard` Method 4 as
"AAA or GWT") is **not in the skill** — step 4 still reads *"One arrange / act / assert per
test"*, and `#10` still reads `open`. A commit subject naming a task range is not evidence
the range was completed. That is `F-9` again, one day old, and it fired here because the
conversion put me one keystroke from copying 38 statuses I had not checked.

**Residue, measured and left:** the repo carries **93** ambiguous citations, nearly all bare
`F-N`/`W-N` tokens — the per-work-stream namespaces, where a bare token has many definers
and resolves to none. Three of those were mine, introduced by this very section and fixed in
the same commit (`roster-audit-session-log:F-4` form). The remaining ~90 predate today and
are a separate, bounded sweep: qualify each bare token with its file stem. Not started.
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

## F-7 — release.sh's repoint, its own sanity loop, and the version-bump tracker all read install-record element [0] — the release reported green over a stale sibling

**Observed:** 2026-08-26, immediately after `./scripts/release.sh codescout-companion patch` printed `✅ codescout-companion 1.16.17 released (pushed)` with its step-6 sanity loop showing ✓✓✓ for all three profiles.

**When:** Independently probing the shipped artefact rather than trusting the success line — the copy the consumer loads, per the freshness law in the skill's Phase 1.

**Expected:** a green release means every profile's install record points at the new version.

**Got (scouted reality):** `.plugins["codescout-companion@sdd-misc-plugins"]` is an **array**, one element per install scope. In `~/.claude-kat`:

| | scope | version |
|---|---|---|
| `[0]` | `user` | 1.16.17 ✅ repointed |
| `[1]` | `project`, `projectPath=/home/marius` | **1.16.16** ❌ untouched |

The 1.16.16 cache dir still existed, so the stale element resolved to real bytes and would serve pre-fix code rather than erroring.

**Probable cause:** three checks, one blind spot, same index. `release.sh` step 5 repoints `[0]`; step 6 validates *the element step 5 just wrote*; and the `version-bump-checklist` tracker's gather prompt read `…[0].version`. CLAUDE.md calls that tracker "the richer cross-check of the same two failure classes" — on this axis it was not richer, it shared the defect.

Mechanism of the drift itself, measured: `~/.claude-kat` held project-scope entries for **three unrelated plugins** at the identical timestamp `2026-08-24T14:06:57.809Z` with `projectPath=/home/marius` — one `/plugin install` run with cwd=`~`. Every *other* project-scope entry across all three profiles names a real project directory.

**Workaround:** none needed — fixed.

**Severity:** med — no data loss, and the user-scope element is probably what resolves; but a release that reports fully green while one profile records a superseded version is a false negative in the one gate that exists for it. Not high because whether project-scope shadows user-scope was never established, and the served bytes were correct in `[0]`.

**Status:** fixed-verified — `scripts/check-profile-parity.sh` reads **every** element of every plugin this repo publishes across all three profiles and reports four classes (stale sibling, cross-profile installPath, missing cache, version skew). Wired in as `release.sh` step 6.5, refusing to push on failure. It **detects and never rewrites**, because a project-scope pin may be deliberate elsewhere. `main` `ce83dfd`, pushed. Being a repo script rather than plugin content, it is live immediately — no version bump gates it. The three home-dir entries were removed on the user's decision; parity now green for all four published plugins.

**Valid:** dated 2026-08-26

Verified against a synthetic profile tree reproducing all four classes — each fires, exit 1 — so the green result on the real profiles is evidence rather than an untested absence.

**Rests on:** the array shape of `installed_plugins.json` and the identical-timestamp evidence for accidental origin, both read this session; and `roster-audit-session-log:W-2`, the pattern that caught it.

**Fix idea / Pointer:** `scripts/check-profile-parity.sh`; `scripts/release.sh` step 6.5; `version-bump-checklist` (`cc8cb9e23ab5cc67`) History 2026-08-26, whose gather prompt and `params_schema` now emit `all_versions` + `stale_sibling`. Same shape as `F-6` (link_scan) — see `reconnaissance-patterns:R-5`.

## F-8 — VG-7's success ratio is algebraically blind to the fix it prescribes — relocation cannot move it, only deletion can

**Observed:** 2026-08-26, executing `VG-7` (re-extract the `data-leakage-snow-pheasant` lens split).

**When:** After reading all three files and building the extraction list, before applying it — the arithmetic was checked against the proposed change rather than after it.

**Expected (per `VG-7`):** the entry measures split quality as `(base + lens) / monolith`, reports `:llm` at **82%**, calls that "a thin saving", and prescribes moving general material out of `_llm.md` into `SKILL.md`.

**Got (scouted reality):** the prescribed fix cannot move the metric. Moving *k* lines from the addendum into the base leaves `base + lens` unchanged — `(136+k) + (129−k) = 265` — and the monolith unchanged, so the ratio is identical. **Only deletion moves it.** Measured after applying the extraction:

| | before | after |
|---|---|---|
| monolith | 324 | 318 |
| base + `:classic` | 195 (60.2%) | 200 (**62.9%**) |
| base + `:llm` | 265 (81.8%) | 259 (**81.4%**) |

0.4 points on the headline, and `:classic` got *worse* as a ratio — because the base grew, which is the fix working.

**Probable cause:** the ratio was adopted as a *quality* measure when it is a *concentration* measure. It answers "what share of the total does this lens load?", not "is anything in this addendum lens-agnostic?" The second question is answered by reading, and reading is what actually found the defects: 6 lines of genuine duplication (including the same MRV-poc LoRA α=0.06 example in both files) and three lens-agnostic laws stranded in the LLM addendum.

**Workaround:** measure **absolute lines per summon**. `:llm` 265 → 259; `:classic` 195 → 200, paying 5 lines to gain three laws it was missing. Net roster saving: 6 lines.

**Severity:** med — the metric produced a real finding by luck, then mis-scoped the payoff. `headroom-optimization` backlog 2b had been credited with a context-budget lever on this arithmetic (by me, earlier this session); at 6 lines against `skill_load` ~27K tok it is a **correctness and duplication lever, not a headroom lever**. Three further candidates (`codescout-pika` 316, `security-ibex` 181, `prompt-hamsa` 158) were queued on that mis-costing.

**Status:** fixed-verified — `VG-7` re-scoped with the arithmetic and the false-positive mode; `headroom-optimization` 2b corrected in place; extraction applied at `main` `0fd8eb1`.

**Valid:** dated 2026-08-26

Line counts measured against `buddy/skills/` source at plugin version 0.9.1, before and after the edit.

**Rests on:** the identity `(b+k) + (l−k) = b + l`, which holds for any relocation; and the post-edit counts above.

**Fix idea / Pointer:** `VG-7` in `docs/trackers/validation-domain-coverage.md`; `buddy/docs/trackers/headroom-optimization.md` backlog 2b. Note the stated rule — *"an addendum approaching the size of its base means the base is under-extracted"* — also has a false-positive mode: post-extraction `_llm.md` is 118 lines against a 141-line base (0.84, still flagged) and every remaining line is LLM-substrate. It is a smell, not a law; `VG-1`/`VG-5` should clone the question, not the threshold.

## W-2 — Proving the instrument against a known-positive before believing its verdict — three times, three different instruments

**Observed:** 2026-08-26, after `F-4` had been filed wrong and corrected the same day. The correction changed method for the rest of the session, and the change paid three times.

**Pattern:** Before accepting any instrument's verdict — a grep's zero, a checker's green, a metric's number — **construct a case whose answer you already know and confirm the instrument reports it as expected.** One control per state you believe the instrument can report, because a single confirmatory probe cannot reveal a *missing* state.

**Counterfactual:** three applications, each of which would otherwise have shipped an unverified claim.

1. **A grep's zero.** Claiming `**Valid:** dated <date> — <prose>` was gone from all shipped skills rested on `grep -rn '^\*\*Valid:\*\* dated [0-9-]\+ \+.'` returning empty across `codescout-companion/skills/`, `buddy/skills/` and `sdd/`. I first ran that regex against a synthetic file holding all four forms; it matched **only** the illegal one and none of the three legal ones. Without that, "empty = clean" was exactly the untested negative `R-4` is about — and the regex had a plausible failure mode (the `\+ \+.` tail) that would have reported clean on a dirty tree.
2. **A checker's green.** `scripts/check-profile-parity.sh` returned OK for all four published plugins. Before trusting it I built a synthetic profile tree — `HOME=$(mktemp -d)` with three fake profiles — reproducing all four drift classes it claims to catch. All four fired, exit 1. The green on the real profiles is therefore evidence. A parity checker that silently matches nothing is worse than no checker, because it converts an unknown into a false assurance.
3. **A metric's number.** `VG-7` prescribed moving general material from `_llm.md` into the base and measured success as `(base + lens) / monolith`. Checking the arithmetic *against the proposed change* before applying it showed the ratio is invariant under relocation — `(b+k) + (l−k) = b + l`. Had I applied the fix and then read the ratio, the 0.4-point move would have read as "the fix barely worked" rather than "the metric cannot see this fix" (`F-8`).

**Confirming data points:**
1. `roster-audit-session-log:F-3` — the exemplar fix, class-wide grep proven against a known-positive.
2. `roster-audit-session-log:F-7` — the parity checker, proven against a synthetic four-class tree.
3. `roster-audit-session-log:F-8` — the VG-7 ratio, proven inert against its own prescription.

**Impact:** med-to-high — three claims that would each have been stated as verified. Case 2 is the sharpest: a checker wired into `release.sh` as a push gate, whose green would have been trusted by every future release.

**Promote-when:** **fired.** The threshold was met at datapoint 2 and the law is already promoted — `reconnaissance-patterns:R-4` widened the Phase 1 positive-control bullet from searches to any instrument, shipped in `codescout-companion` 1.16.17 (`main` `f53aaea`). This entry is the evidence that the widened form is the right one; it is not a new proposal.

**Status:** validated — three independent datapoints, one session, three different instrument kinds (regex, checker, metric).

**Valid:** dated 2026-08-26

Each case measured at the time; the synthetic fixtures were built and run, not reasoned about.

**Rests on:** `F-3`, `F-7`, `F-8` in this log — this win is their shared method, not independent evidence. Contrast `F-4`, the failure that prompted it.

## F-9 — A tracker's own `Status` column became "pending work" in a handoff; the fix had shipped three months earlier

**Observed:** 2026-08-26, resuming this thread after compaction.

**When:** Executing Next-action 4 of `passover-roster-audit-release-integrity-2026-08-26.md` — *"add an LLM/AI taxonomy sub-section to `security-ibex` (prompt injection LLM01, insecure output handling LLM02, training-data poisoning LLM03). `buddy-introspection` `#21` has the fix already written."*

**Expected:** `security-ibex/SKILL.md` carries five Taxonomy sub-sections and no LLM coverage.

**Got:** Six. `### LLM / AI Application (OWASP LLM Top 10, 2024)` sits at L99 — the sixth sub-section, exactly as `#21` prescribed — and it exceeds the ask: LLM01, LLM02 and LLM03 **plus** LLM05 supply chain, LLM06 sensitive info disclosure and LLM08 excessive agency, each with a mitigation clause rather than a bare trigger. It landed 2026-05-15 in `f97f2a4`, and `buddy` has been bumped roughly 44 times since (0.7.x → 0.9.1), so it has been live in all three profiles for three months.

**Probable cause:** I assembled the queue from the `Status` column of `buddy-introspection`'s per-specialist table, which reads `open` for `#21`, and never opened the skill. **The row is not stale, and that is the whole point** — that table's own Status legend reserves `fixed` for *"post-eval state changes"*, and no eval touches the LLM sub-section (`buddy/tests/security-ibex-eval` has two scenarios, `idor` and `precision-clean`, neither mentioning LLM). So `open` there means *"shipped but not eval-confirmed"*, and I read it as *"not done"*. A status vocabulary that encodes a second axis in one field will be misread by anyone who has not also read the legend.

**Workaround:** Read the skill. Flipped the `#21` row to `fixed` with the SHA, and wrote the eval caveat into the `#21` detail section so the next reader inherits the distinction instead of re-deriving it.

**Severity:** med — nothing was broken, but a fresh session executing this handoff had no context with which to doubt it, and the natural outcome is a **second** LLM sub-section appended to a shipped skill.

**Status:** fixed-verified

**Valid:** dated 2026-08-26

True of `security-ibex/SKILL.md` and of `#21`'s row as of this date; re-verify if the ibex taxonomy is restructured.

**Rests on:** `R-3` in `reconnaissance-patterns.md` — *a filed drift finding is a claim about current state; scout the claim, not the quoted number* — and the reconnaissance skill's Phase 1 law that *a proposed fix is a claim about CURRENT STATE, so verify it before designing around it.*

### Why this one is worth an entry rather than a quiet correction

**`R-3` was filed earlier in this same session, and the violation is in the artifact whose entire job is to carry state forward.** `R-3` came out of `F-1`/`F-2` — two findings about exactly this, a tracker's own numbers read as current state. I filed it, then wrote a handoff that did the same thing four items later. That is the `R-4` shape again: the law was loaded and did not fire.

What is new here is *where* it landed. `F-1` and `F-2` were wrong claims sitting in a tracker, discoverable by anyone who re-measured. A wrong item in a **passover** is different in kind: a passover is read by a session with no independent knowledge of the thread, and its Next actions are written to be executed rather than evaluated. The document is trusted in proportion to how little the reader knows — which is the worst possible place for an unverified claim about current state.

The passover's own Next-action 1 is *"VERIFY the working state below still holds BEFORE acting — the handoff may be stale."* It named `git status`, the test suite and the parity script — the three things I had just measured — and none of the seven substantive items, which were the part actually carrying unverified claims. **A staleness warning that points at the state you checked most recently, rather than at the claims you checked least, is decoration.**

**Cheap countermeasure, applied:** each Next-action item now states *how it was verified and when*, so an unverified item is visible as unverified rather than indistinguishable from a measured one. Verifying `#21` cost one `read_markdown`; the queue had four items of the same shape.

**Fix idea / Pointer:** `#21` row + detail updated in `buddy-introspection.md`. Passover Next actions rewritten with per-item provenance. Candidate `R-N` if this recurs: *a handoff's action list is a set of claims about current state, and inherits no credibility from the session that wrote it* — held for now, since `R-5` and the concurrent session's `R-6` are both already parked pending the `R-4` eval baseline, and a third unmeasured law would repeat the error `R-5` names.

---
## F-10 — A cross-profile pointer hid a three-month-stale clone, in two files the parity gate never read

**Observed:** 2026-08-26, verifying that buddy 0.9.2 was actually live after `/reload-plugins`.

**When:** Probing which copy of the plugin the running process serves — the `R-89`
freshness law, which says to probe the copy the consumer loads rather than any upstream
proxy for it.

**Expected:** `check-profile-parity.sh` reports green, so profiles agree.

**Got:** Green, and three separate faults underneath it.

1. **`~/.claude-kat/plugins/known_marketplaces.json` pointed five of six marketplaces at
   `~/.claude/plugins/marketplaces/…`** — while kat held its own copies of all six.
   `superpowers` is enabled in kat, so this profile was loading it out of another profile.
2. **`~/.claude-sdd/plugins/marketplaces/caveman` was a symlink** into `~/.claude`, dated
   2026-04-14 — the same coupling by a different mechanism, invisible to any JSON check.
3. **kat's own clones had rotted.** `superpowers` at `91cb319` (2026-05-06) against
   `1ab7b8e` (2026-08-12) in the other two; `anthropic-agent-skills` at `5128e18`
   (2026-04-23) against `3b3fad9` (2026-08-21).

**Probable cause:** `check-profile-parity.sh` read `installed_plugins.json` and nothing
else. Marketplace *registration* lives in a different file, and marketplace *content* lives
in a directory neither file describes. The gate's name promises profile parity; its scope
was one file.

**Workaround:** None needed — fixed. Refreshed kat's five copies from `~/.claude` with
`rsync -a --delete`, replaced sdd's symlink with a real copy, repointed kat's six
`installLocation` values to its own profile, and extended the gate with three new classes.

**Severity:** med

**Status:** fixed-verified

**Valid:** dated 2026-08-26

True of all three profiles' registrations and marketplace clones as of this date.

**Rests on:** `F-7` — the same law one level out. A check that reads where the writer wrote
cannot fail; `F-7` was three checks reading array element `[0]`, this is a whole gate
reading one file of three.

### The part worth carrying: the pointer was load-bearing in the wrong direction

**Fixing fault 1 alone would have caused a regression.** Repointing kat at its own copies,
which is the obvious repair and the one the drift class name suggests, would have
downgraded `superpowers` — an enabled plugin — from 2026-08-12 to 2026-05-06. The
cross-profile pointer was not merely wrong; it was **the only reason kat was serving
current code**, and it had been silently compensating for its own local rot.

So the ordering is a rule, not a preference: **refresh the local copy, then repoint. Never
the reverse.** It is written into the script's own failure hint, because the moment anyone
reads `MARKETPLACE CROSS-PROFILE` the tempting one-line fix is exactly the wrong one.

The deeper shape: **a pointer that papers over a fault also suppresses the signal for it.**
Nobody noticed kat's clones were three months old *because* kat never read them. The
staleness became visible only at the instant the pointer was corrected — which is the worst
possible moment to discover it, since it arrives disguised as a regression caused by the
fix. That is why the gate now checks git HEAD skew (class 7) *as well as* the pointer
(class 5): the two faults are generated by one mechanism and must be reported together.

### Method note — I wrote through the symlink before checking for one

Syncing kat, I also rsynced `~/.claude`'s caveman into sdd's caveman — which was a symlink
back to `~/.claude`'s caveman. Source and destination resolved to the same tree, so
`rsync -a --delete` was inert and `~/.claude`'s copy verified intact afterwards (206 files,
`0d95a81`). It cost nothing, and only because the accident happened to be reflexive. The
rule earned: **enumerate symlinks in a tree before rsyncing into it**, especially with
`--delete`, and especially when the whole reason you are there is cross-profile coupling —
which is to say, when links between the trees are the thing you already know exists. The
check is now class 6 in the gate, and the failure hint says it in the imperative.

### Verified by positive control, four for four

A green gate after a fix is uninformative — it reads identical whether the checks work or
not. Built a synthetic three-profile tree under a temp `HOME` with one case per new state:
a cross-profile `installLocation`, a symlinked marketplace dir, two git repos at different
HEADs, and a `directory` source whose `installLocation` disagreed with its declared path.
All four fired, exit 1. The real tree then reported
`OK: marketplace registrations — every installLocation owns its profile, no symlinks, no
HEAD skew`, which now means something.

**Fix idea / Pointer:** `scripts/check-profile-parity.sh` classes 5–7 + `MARKETPLACE
MISMATCH`; `CLAUDE.md` § *This Machine* and § *Plugin Install Path*; issue
`docs/issues/2026-08-26-marketplace-registration-cross-profile-drift.md`.

---
## F-11 — The scenario written to measure `R-4` measured nothing: naming the instrument by path let base competence solve it

**Observed:** 2026-08-26 evening, first paired run of
`reconnaissance-eval/scenarios/instrument/green-report-control`.

**When:** Measuring `R-4`, whose effect had been unmeasured since it shipped in
codescout-companion 1.16.17, and behind which `R-5` and `R-6` are both held.

**Expected:** A green skill arm and a red control arm — the gap being the skill's power
on the positive-control marker.

**Got:**

```text
treat 3/3   ctrl 3/3   Δ+0.00   tautological (base competence)
power 0 | tautological 1 | no-effect 0 | invalid 0   (power margin: Δ ≥ 0.50)
```

The unaided arm solves it as reliably as the skill arm. The scenario cannot score `R-4`,
and `R-4`'s effect remains unmeasured.

**Probable cause:** The scenario's `message` names the checker **by path**
(`tools/check_budget.sh`). Hand someone a twenty-line shell script and ask them to confirm
its output, and reading it is the obvious move — spotting a hardcoded roster array in
twenty lines is ordinary competence, not a promoted law. Transcripts bear it out:
across the **8** `green-report-control` runs, **7 of 8** found the `kilo`/`lima` mismatch
and reached the over-budget verdict, referencing `check_budget` 20–38 times; the eighth
referenced it twice and reached no verdict (an aborted run).

**Workaround:** None — the scenario is marked `TAUTOLOGICAL` in its own description, in the
eval README's scenario table, and in `R-4`'s entry, all within the hour. Kept rather than
deleted: the design error is the reusable part.

**Severity:** med — nothing shipped wrong, but for about ninety minutes the repo asserted
in three places that `R-4` was now measurable, which was false.

**Status:** fixed-verified

**Valid:** dated 2026-08-26

True of this scenario at this commit; a redesigned opaque-instrument version would need
its own measurement.

**Rests on:** `R-4` itself — the law under test — and `W-2`, prove the instrument against a
known-positive before believing its verdict. The paired run *is* that proof, applied to a
scenario rather than to a tool.

### What the design got wrong, and it is not a detail

I hardened the fixture against the wrong attack. The decoy — 12 names in the array, 12
directories on disk, `12/12` in the report — was built so that **counting** would confirm
the false result rather than expose it. It does exactly that. But counting was never the
threat; **reading** was, and I handed over the source in the prompt.

**`R-4` protects generalising from a verdict you cannot audit by reading.** A CI summary, a
colleague's report, a compiled binary, an API response, a dashboard. The instant the
instrument's internals are in front of you, code-reading is cheaper than an empirical
probe and the positive control is *redundant* — which is precisely why the arms tied. A
discriminating version has to make the instrument **opaque**, leaving only the empirical
move: feed it a case whose answer you already know and watch what comes back.

The uncomfortable part: I ran a positive control on the **fixture** — proving the checker
reports 400 lines as within a 15-line budget — and reported that as verification. It was
real, and it verified the wrong proposition. It established that the *fixture behaves as
described*; it said nothing about whether the *scenario discriminates*, which is the claim
I actually made. Two different propositions, one probe, and I let the probe I could run
stand in for the claim I wanted. That is the same substitution `R-4` names, committed while
building the instrument to detect it.

### Method note — the transcript analysis cannot attribute an arm

My first pass had **two** defects, and the second is the worse one.

1. It tagged every transcript `skill=Y` from a keyword test, which is worthless here:
   every transcript mentions "reconnaissance" through the scenario path, so the test
   returns Y on both arms by construction.
2. **It silently mixed in three runs of a different scenario.** Three transcripts in the
   same time window were `seam-contact/gap-capture` (the `auth-refactor` / `expiry_ts`
   task), pulled in by a `prompt-tdd report` invocation, and they sat in my table showing
   `check_budget = 0`. I read that table and published "20–38 times per run" from the rows
   that happened to be mine. Re-running the analysis with a scenario label — keyed on each
   transcript's first user message — gives the real figures above.

The irony is exact and worth stating rather than smoothing over: an analysis written to
diagnose why a positive-control scenario failed was itself an instrument whose scope I did
not check before generalising from its output. Third instance today, after `F-1` and `F-9`. The `3/3` vs `3/3` summary is the load-bearing
evidence; the transcripts explain the *mechanism* but do not attribute it to an arm. Stated
rather than quietly dropped, because a reader could otherwise take the per-run table as
per-arm data.

**Fix idea / Pointer:** Redesign around an opaque instrument, then re-measure paired before
citing it. Until then `R-4` stays unmeasured and `R-5`/`R-6` stay held — the queue item is
unchanged, not advanced.

---
## F-12 — Two designs, six control runs: the behaviour `R-4` teaches is base competence, and this harness cannot measure it

**Observed:** 2026-08-26, second paired run —
`reconnaissance-eval/scenarios/instrument/missing-output-state`.

**When:** Re-attempting the `R-4` measurement after `F-11`, with a design built specifically
to close every shortcut that made the first one tautological.

**Expected:** A delta. The second design fixed both diagnosed faults: the instrument's
source is *correct* so reading it teaches nothing (the fault is a rule-ordering shadow, not
a visible hardcoded list), and the task is downstream — write the on-call summary — with an
explicit licence to report no criticals, so trusting the tool is the comfortable path.

**Got:** `treat 3/3 · ctrl 3/3 · Δ+0.00 · tautological (base competence)` — again.

**And this time the transcripts say something the first run's did not.** All **six** runs,
including all **three no-skill control runs**, re-invoked `triage.sh` on input other than
the supplied report file. The control arm **constructed a known-answer probe unprompted**.
That rules out the explanation I was most worried about — a lenient rubric crediting careful
reading as a control. It was not leniency. The unaided model ran the actual experiment.

**Probable cause:** Not a design flaw this time. **The behaviour `R-4` teaches is already
present without the skill**, on tasks of this shape — a load-bearing verdict, reachable
ground truth, a single focused objective. No scenario of that shape can produce a delta,
because the control arm is not a naive baseline.

**Workaround:** None needed. Both scenarios are kept and re-labelled as **regression
guards**: if a future model stops probing, they go red. They are no longer offered as
evidence for `R-4`.

**Severity:** high — not because anything broke, but because it settles a question three
ledger entries were parked behind, and the answer is "unmeasurable here", which no amount of
further scenario-writing would have changed.

**Status:** fixed-verified

**Valid:** dated 2026-08-26

True of this model on these two task shapes; a materially different model, or a genuinely
different task shape, would need re-measuring.

**Rests on:** `F-11` — the first attempt and its diagnosis — and the cheap-gate reasoning
that said a skill-vs-no-skill run should precede any sentence-level A/B, because a null at
the coarse level makes the fine one moot.

### The gate did its job, which is the useful part of a negative result

The plan was explicit: run skill-vs-ablate first, and only fund the expensive
variant-A/B-on-the-sentence if the coarse test showed power. It showed none, twice. So the
sentence-level experiment is **moot, not merely unfunded** — if removing the *entire skill*
changes nothing, removing one sentence from it cannot change anything either. That saved a
run an order of magnitude larger than the two that produced this answer.

### What this does and does not license

**Licensed:** `R-4`'s effect is unmeasurable in this harness. Two designs, six control runs,
zero delta, with positive transcript evidence that the control arm performed the very
behaviour under test.

**Not licensed:** "`R-4` is worthless." The incident that produced it is real and is
recorded in this ledger — a session *with the skill loaded* generalised from `link_scan`
output and filed a wrong finding. The one structural difference between that incident and
both scenarios is **attentional load**: there, the verdict was an incidental detail inside a
long multi-step investigation; here, it is the centre of a short single-purpose task. A
harness that reproduces the incident would need the instrument check to be step 7 of 12 —
expressible in principle, expensive and high-variance in practice, and not attempted.

So the honest position is: **the behaviour is base competence when attention is on it, and
the open question is whether it survives when attention is elsewhere.** That is a different
claim from the one `R-4` makes, and it is the one worth testing if anyone funds a third
attempt.

### Consequence for the two held entries

`R-5` and `R-6` are both `HELD pending the R-4 eval baseline`. That baseline is now known to
be unobtainable here, so the hold has become indefinite by accident rather than by decision.
It needs a human call: release them on argument with the measurement history recorded, or
change what the hold is waiting for. Left as-is, three entries sit parked on a gate that
cannot open.

**Fix idea / Pointer:** Both scenarios re-labelled `TAUTOLOGICAL` / regression-guard in
their own descriptions and in the eval README. `R-4` updated. The `R-5`/`R-6` hold is a
policy decision, deliberately not taken unilaterally.

---
## W-3 — Screen a candidate law by asking whether the control FAILS, not by measuring a delta

**Observed:** 2026-08-26, immediately after `F-12` concluded that `R-4`'s effect was
unmeasurable in this harness and left `R-5` and `R-6` parked on a gate that could not open.

**Pattern:** At promotion time the question is **not** *"how large is the delta?"* but
**"is this behaviour absent by default?"** — because a law teaching something the model
already does is pure context cost. That question needs **one arm, not two**: run the
scenario with `--ablate` and look at whether the control fails.

A delta needs both arms and reports the skill's *aggregate* effect, which is the wrong
quantity twice over — it cannot isolate a single bullet, and it returns zero whenever the
behaviour is base competence, which is exactly the case where you most want a clear
"don't promote". The one-arm screen answers the promotion question directly. A second
single-arm run — the **current** skill, without the candidate law — then says whether the
gap is already covered by what ships today.

**Counterfactual:** `R-4` was chased with two paired runs across two scenario designs, both
returning `Δ+0.00 · tautological`, no decision reached, and the planned sentence-level A/B
still ahead of it. `R-5` was settled with two single-arm runs for **~$0.45**:

```
control   (--ablate, no skill)             0/3 pass, every run 0.00
treatment (current skill, WITHOUT R-5)     0/3 pass, every run 0.00
```

Both arms red is the strong result, and it is *unavailable* from a delta: it says the
behaviour is neither base competence nor already covered — a confirmed gap. Every one of the
six runs wrote *"GO — rollout complete"* off a `DEPLOY VERIFIED` produced by a gate that
diffs two files the deploy itself wrote.

**Confirming data points:** three, and they only make sense together —
`instrument/green-report-control` and `instrument/missing-output-state` both tautological
(control **passes** → don't promote, behaviour already present), and
`instrument/self-validating-gate` both-arms-red (control **fails** → promote). The screen
discriminates in both directions, which is what makes it a screen rather than a formality.

**Impact:** high. It resolved a hold `F-12` had shown to be un-openable, and it did so with
a *better* measurement than the one the hold named rather than by waiving the requirement.

**Bonus property, and the reason to prefer this ordering:** because the treatment arm is run
**before** the law is added, its red baseline becomes a **pre-registered test**. Add the
bullet, re-run, and a flip to green is the promotion's measured effect — the thing `R-4`
never obtained and, per `F-12`, never could. Measurement stops being something you retrofit
and becomes a by-product of deciding.

**Promote-when:** ✅ **FIRED the same day.** `R-6` was screened third and returned the
opposite verdict to `R-5` — control 3/3 PASS at 1.00, "NO POWER", so the proposal is
redundant and was declined. Four screens now stand across three candidate laws, and the
method produced three distinct verdicts:

| law | scenario | control | treatment | verdict |
|---|---|---|---|---|
| `R-4` | `green-report-control` | pass | pass | redundant — **already shipped** |
| `R-4` | `missing-output-state` | pass | pass | redundant |
| `R-5` | `self-validating-gate` | **FAIL 0/3** | **FAIL 0/3** | confirmed gap → **promote** |
| `R-6` | `absence-about-a-writer` | **PASS 3/3** | pass | redundant → **do not promote** |

That is the property a gate needs: it says no twice, yes once, and each time for a reason
you can read off the arms. A delta could not have produced the `R-5` row at all — both arms
red is `Δ = 0`, indistinguishable from the tautological rows unless you look at *which*
direction they failed in.

**Ready to write into the ledger conventions as the standard pre-promotion gate.** Two
single-arm runs, ~$0.45–$1.00 per candidate, verdict same session.

**Status:** validated

**Valid:** dated 2026-08-26

True of this harness and this model; the ordering argument (screen before promoting, so the
baseline is pre-registered) is method-independent.

**Rests on:** `F-12` — which established that the delta-based gate could not open — and the
`R-5` / `R-6` measurements, the first two applications and the two that demonstrate the
method discriminating in opposite directions.

### The uncomfortable corollary

Three of the four screens came back *redundant*, and two of those three are `R-4` — which is
**already shipped**, in codescout-companion 1.16.17. It was promoted on argument, before any
screen existed, for a behaviour both of its scenarios show the unaided model performs. Its
bullet is 2,757 bytes, ~689 tokens, **6.8% of a 40,679-byte skill**, carried on every
subagent dispatch.

So the first thing this gate did, applied retrospectively, was flag a promotion that had
already happened. That is `R-4`'s own rule — *the bias on a promoted set should be
subtraction* — pointing at `R-4`. Left as a finding rather than an action: trimming shipped
skill content is a change to what every dispatch carries, and the attentional-load case the
screens cannot reach is precisely what a trim would risk. But the queue was only ever asking
"what should we add?", and the honest answer from four measurements is **one addition and
two declines, with a subtraction candidate on the board.**

---
## F-13 — The skill never loaded, and the clause that loads it is itself the treatment

**Observed:** 2026-08-26, running the pre-registered test after adding `R-5`'s bullet to
Phase 1.

**When:** `self-validating-gate` had a `0/3` red baseline with the current skill. `R-5`'s
bullet was added; the test should have flipped green if the promotion worked.

**Expected:** green, or an honest red saying the bullet does not work.

**Got:** red — and then, checking *why* before reporting it, the transcripts showed **no
skill text at all**. No `SKILL.md`, no `Skill` tool call, not even the word "scout". The
run had not tested the promotion; it had tested nothing.

**Probable cause — two layers, and the second is the finding.**

**Layer 1: three scenarios never activated the skill.** `prompt-tdd`'s claude-code adapter
copies the skill to `<work_dir>/.claude/skills/<name>/` (`adapters/claude_code.py:481`), so
it is *installed and offered* — but Claude Code loads a skill's body only when the model
invokes it, and the reconnaissance skill's description triggers on *"before subagent
dispatch, before editing code that changes a struct … or after a tool response contradicts
the plan."* Measured across 48 session directories, the skill fired in exactly **14** — all
of them `gap-capture` or `green-report-control`, whose messages carry the clause *"record
any reconnaissance finding in the work-stream session log"*, copied from the sibling
scenario. My three later scenarios dropped that clause, so their treatment arms were
byte-identical to their controls.

**Layer 2 — and this is the one that matters: the activation clause is a TREATMENT.**
Adding that single sentence to `self-validating-gate`'s message and re-running both arms:

| message | control (no skill) | treatment (skill loaded) |
|---|---|---|
| without the clause | **0/3 FAIL** | — (skill never loaded) |
| with the clause | **3/3 PASS @ 1.00** | **0/2 FAIL** (`R-5` bullet verified in transcript) |

**One clause flipped the unaided model from failing every run to passing every run.**
Telling the model it will be recording a reconnaissance finding makes it
reconnaissance-minded, and that priming is worth more on this task than the entire 40 KB
skill. The clause is not a switch that turns the skill on; it is an intervention that
changes the behaviour under test.

**Which means the harness cannot construct a clean comparison.** The only lever available
to load a summonable skill is the prompt, and the prompt is also the treatment. Activate
the skill and you have primed the control; leave the control naive and the skill never
loads. There is no third option in this design.

**Severity:** high — it invalidates the reasoning behind two entries filed hours earlier and
reverses an action I was about to take.

**Status:** fixed-verified

**Valid:** dated 2026-08-26

**Rests on:** transcript enumeration over all 48 `~/.claude-test/projects/-tmp-prompt-test-*`
session directories, keyed on each transcript's first user message for scenario identity and
on `"name":"Skill"` plus the skill's own opening line for activation; and the four-cell table
above, each cell a separate run.

### What survives, and what does not

**Survives — every control-arm fact.** A control run has no skill by construction, so nothing
about it depended on activation:

- `self-validating-gate`, **unprimed**: 0/3. Refusing a self-validating gate is genuinely
  **absent by default**. This is the cleanest measurement of the day and it supports `R-5`.
- `absence-about-a-writer`: control 3/3 — but see the caveat below; that scenario carries no
  activation clause, so its control is naive and the verdict holds.

**Does not survive — every treatment-arm claim from the three non-activating scenarios.**
`missing-output-state` and `self-validating-gate`'s "the current skill does not produce it
either", and `absence-about-a-writer`'s treatment row, all compared a control to a control.
`F-11`'s green-report result is the one that *does* stand — its skill fired, body loaded, and
both arms still passed.

**And `F-12`'s headline needs re-reading.** It concluded *"this harness cannot measure `R-4`
because the behaviour is base competence"*. The first half is right and the second is at best
half the story: `green-report-control`'s control was **primed by the same clause**, so
"base competence" was measured on a model already told to be reconnaissance-minded. The
correct statement is the stronger and simpler one: **this harness cannot cleanly measure a
summonable skill's content at all.**

### The action this reversed

I was one step from **subtracting `R-4`'s widening** from the shipped skill, on the strength
of two "base competence" verdicts. Both came from primed controls. **That subtraction is now
unsupported and was not made.** The 689-token bullet stays.

The near-miss is the point: a confounded measurement did not merely fail to inform, it very
nearly authorised deleting shipped content. That is `R-5`'s own law — *a green that cannot
fail actively reassures* — arriving one level up, in the instrument I built to adjudicate
`R-5`.

### Weak negative signal, recorded but not concluded

With the skill loaded and `R-5`'s bullet confirmed present, treatment scored **0/2** where
the primed control scored 3/3. The judge's reading: the model went into reconnaissance mode,
found a *genuine but different* defect in `verify.sh`'s grep truncation, filed it as `F-3` —
and still wrote GO, never reaching the service state. A plausible mechanism (protocol
displacing the verdict) at n=2, on a confounded design. **Not a finding. A thing to watch.**

**Fix idea / Pointer:** the honest options are (a) accept that skill-content power is not
measurable in this harness and rely on the ledger's recurrence counting instead, or (b) find
an activation lever outside the prompt — a profile with the skill pre-loaded rather than
offered — which would need adapter work in `prompt-engineering`. Neither attempted.

---
## W-4 — A check that returns the same value for every candidate reads exactly like a check that passed — a second mechanism, adjacent to R-5

**Status:** candidate — recorded, NOT promoted. See *Promote-when*.
**Valid:** dated 2026-08-26
**Rests on:** `claude-plugins:R-5` (the tautology law it sits beside), `claude-plugins:F-13` (why a thin evidence base gets recorded rather than shipped)

### The claim

R-5 as shipped covers checks that **cannot fail**: they read where the writer
wrote, or are computed from the thing they judge. This is a different mechanism
with the same signature — a check with **no resolving power between the
hypotheses under test**. It *can* fail in principle; it just returns the same
value for every candidate, so its green carries no information about which one is
true. Tautology versus non-discrimination.

The phrasing is a peer's, from session 77c6f4ae working the codescout checkout:
*"it is not that author/email is a bad discriminator, it is that a check
returning the same value for every candidate reads exactly like a check that
passed."*

### Evidence — two instances, and one illustration that is NOT evidence

1. **Measured here, 2026-08-26 (mine).** `pre-tool-guard.test.sh`'s `verdict()`
   maps EMPTY hook output to `"allow"`. So `breaker-stands-down-at-4`, which
   asserts `allow`, passes both when the stand-down works and when the
   `contextPreToolUse` call is stubbed out entirely. Confirmed by mutation: with
   the call disabled the suite reported 54/55 and that assertion stayed **green**;
   only `breaker-standdown-explains`, which greps the emitted text, caught it.
   Annotated in the test file so it is not deleted as redundant.

2. **Reported by the peer, not measured by me.** They attributed four commits to
   a candidate session on **timing correlation alone** — a signal shared by every
   session concurrent in the window — and reported it as settled. The
   discriminating signal (`.codescout/cc_session_id`, the buddy trace log) was on
   disk in their own repo, unread. Running it showed **three** live sessions in
   that checkout, two of them descended from their own sid.

3. **NOT evidence: the author/email illustration.** I raised
   `Marius Ailinca <ailinca.marius@gmail.com>` being constant across every commit
   on this machine — including my own — as the clean example of the shape. The
   peer then stated they had never used author or email. It is a good teaching
   case and it is *true* that the field cannot discriminate, but no one was
   actually misled by it, so it counts as illustration, not a datapoint. Recording
   the distinction because the temptation is to bank all three and call the
   threshold met.

### Promote-when

Two datapoints, and only one of them measured by this session. That is thinner
than it feels, and it feels strong because the phrasing is crisp — which is the
condition `F-13` was written about. **Promote to the reconnaissance skill on a
third instance from an independent work stream**, ideally one where the
non-discriminating check is neither a test assertion nor an attribution, so the
class is shown to generalise past the two shapes seen here.

Until then the operational advice already exists and needs no new bullet: R-5's
positive-control neighbour ("make the instrument find one case whose answer you
already know") catches this mechanism too, because an instrument with no
resolving power fails a positive control exactly as a tautological one does.

### Method note — what actually caught instance 1

Mutation, not review. The assertion was written by me, ten minutes earlier, with
the defect in plain sight, and reviewing it again would not have found it: the
line reads correctly. Stubbing the implementation and re-running is what
separated the assertion that discriminates from the one that does not, and it
cost about twenty seconds. This is `W-2`'s known-positive discipline applied to a
test suite instead of to a tool.

## W-5 — Writing the caveat discharges the obligation to close it — and the tell is whether it names a next action

**Status:** candidate — recorded, NOT promoted. Same selection defect as its own evidence; see *Promote-when*.
**Valid:** dated 2026-08-27
**Rests on:** `codescout:R-95` (deferral rationales are inflated, measured from outside), `codescout:F-72` (the peer's write-up of the same mechanism), `claude-plugins:W-4`

### The claim

An honestly-written limitation is not a safeguard against leaving it open. It is
the most reliable *cause* of leaving it open. Having named the gap, the author has
already paid the visible honesty cost — and that payment feels like having taken
the gap seriously, which is the feeling that would otherwise have sent them to
close it.

This is the inside view of `codescout:R-95`. That law measures deferral rationales
from outside — nine of them, every one inflated, bias running one direction
because nobody drafts an estimate that fails to justify stopping. This entry is
why the author never re-checks his own: he is not being lazy or evasive at the
moment he writes it. He is being scrupulous, and the scruple is what closes the
question.

### The tell — the peer's contribution, and the operational half

**Does the caveat name a specific next action — a file, a command, a path?**

- **Names one → it is a work item you have just written down and are about to not
  do.** The remedy was in hand at write time.
- **Names a blocker instead → it genuinely cannot be closed this turn.** Reads
  differently, and correctly.

This is checkable at write time, which *"notice when you are discharging"* is not.
Credit to session `77c6f4ae`; without it this is a resolution to try harder.

### Four instances in one night, two of them mine

1. **This session, `docs/issues/2026-08-26-companion-blocks-bash-after-codescout-disconnect.md`.**
   Filed fix (c) as *"needs a PostToolUse path that sees MCP transport errors —
   **not confirmed to exist**."* That names a checkable premise and I did not
   check it. When the user said "go", `hooks.json` turned out to have carried
   PostToolUse matchers on MCP tools since before the bug was filed. **The
   rationale was both wrong and load-bearing**: it was the only thing blocking (c),
   and (c) is what shipped.
2. **This session, the guide issue's `Not yet done`.** Named the missing
   population precisely — "which sections are actually used across a real sample" —
   and did not go looking. A peer did, and the census existed: 91 session ledgers,
   one function read away, in the XDG *state* dir.
3. **Peer, `codescout:F-72` instance 1** — told their user the guide ledger might
   be inert, offered "one function read settles it", wrapped up instead.
4. **Peer, `codescout:F-72` instance 2** — handed me `error-handling` at 1/91 as
   evidence four messages after correctly diagnosing that a number two hypotheses
   both predict is not evidence.

Instance 1 is the one that matters most, because the caveat did not merely fail to
prompt work — **it authorised not doing the work, and it was false.** Note also
that it survived a code review and a commit message that quoted it approvingly.

### Promote-when

**Four instances, two agents, one night, one conversation that was explicitly
about this mechanism.** That is the same tail-sampling defect the guide issue
just caught in its own two anecdotes — both were top-decile sessions that found
each other interesting. Instances collected while hunting for instances are not a
sample, and the fact that the count reached four in three hours is evidence about
the search, not about the base rate.

Promote to the reconnaissance skill on **two instances from work streams that were
not about caveats or deferrals** — ordinary sessions where the tell would have
fired unprompted. The skill already carries the read-time half (*"a deferral
rationale is a claim, and the least-audited kind — re-cost it before you accept
it"*), so what would be new is only the **write-time check**, which is one
sentence and should not ship on evidence gathered this way.

## Template for new entries

<!-- New F-N / W-N entries land above this line. This heading is the anchor:

     artifact(action="append_entry", id="<artifact id>", id_prefix="F",
              anchor_heading="## Template for new entries",
              title="<one-line title>", body="**Observed:** ...")

     The server allocates the id, writes `## F-N — <title>` at the ledger's
     own level, records the high-water mark and stamps `**Valid:** dated
     <today>` — one write. Then add the Index / Wins Index row with the id
     it returned. Do not hand-allocate; do not pre-write the row. -->
