---
id: '62d9ee55d29ea312'
kind: tracker
status: draft
title: Session Log — Repo Hygiene
tags:
- session-log
- repo-hygiene
- reconnaissance
entry_prefix:
- F
- W
entry_high_water_W: 2
entry_high_water_F: 2
---

# Session Log — Repo Hygiene

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Append F-N / W-N entries with:
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
> codescout's `statement-validity-session-log` starts at `statement-validity-session-log:F-2`/`statement-validity-session-log:W-3`
> rather than `statement-validity-session-log:F-1`/`statement-validity-session-log:W-1`
> (see `statement-validity-session-log:F-3` there).
>
> **`edit_markdown` is not the append path**, though it works at first.
> This file ships without `entry_prefix` declared, so it is directly
> editable — but once `entry_prefix` is declared to make the ledger
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
| F-2 | 2026-08-21 | low | codescout-tool | open | codescout's session-log template's own example Index/Wins-Index row burns the id it displays |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-2 | 2026-08-21 | med | Checking `merge-base --is-ancestor` + a machine-wide `doctor` scan before concluding a missing file was deliberately scrubbed | Would have supported a false "deliberately scrubbed" claim or a premature catalog-row delete | validated |

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

## W-2 — Checking ancestor-of-HEAD before concluding a missing tracked file was deliberately scrubbed

**Observed:** 2026-08-21, auditing open bugs in `claude-plugins`. `artifact(find, kind="bug", status in [open, investigating])` surfaced `e01357bc2898153f` (`docs/issues/2026-08-08-build-secret-guard-fail-closed.md`) — tags included `security`, `exfiltration`, `prompt-injection`. `artifact(get)` on it returned `body_error: No such file or directory`, and the file was absent from the working tree and from `git ls-files`.

**Pattern:** Before concluding a security-tagged file's disappearance was a deliberate scrub (and before either declining to investigate further out of caution, or acting on that belief), scout the actual git shape: `git cat-file -e HEAD:<path>` to confirm true absence, `git log --all --follow -- <path>` to find every commit that ever touched it, then `git merge-base --is-ancestor <last-touching-sha> HEAD` to check whether that history is even reachable from the current branch. If unreachable, `git diff --stat <merge-base> <last-touching-sha>` scopes whether it was an isolated file or part of a larger dropped batch — the discriminator between "one orphaned commit" and "a rewrite that scrubbed a set." Finally, run `librarian(doctor)` (machine-wide, not just the active project) to check whether the same `missing_file` defect recurs anywhere else, before generalizing a single incident into a claimed pattern.

**Counterfactual:** Without this scout, the tags alone (`security`, `exfiltration`) plus the file's total absence from git would have supported either a false "deliberately scrubbed for security reasons" claim reported to the user, or a premature `artifact(delete)` on the stale catalog row without checking whether the underlying content was actually preserved elsewhere. The actual shape was mundane: two commits (`8fc78c9f`, `e8d208aa`) on a short branch tip off `b9625ac` that never got carried into `main` — diffing the tip against the merge-base showed exactly one file changed, ruling out a batch scrub — and the substantive content (the PR #9 bypass findings) was independently intact in codescout's own `docs/trackers/pr-review-session-log.md` (`pr-review-session-log:F-4`/`pr-review-session-log:W-3`, 2026-08-07), so nothing was actually lost. `librarian(doctor)` confirmed the `missing_file` check fired exactly once across every repo in the catalog, turning "maybe this happens elsewhere" into a measured negative rather than a guess.

**Confirming data points:**
1. This session — `git merge-base --is-ancestor` returned false for the last commit touching the file, which is what made "history was rewritten, not just deleted" checkable rather than assumed.
2. `librarian(doctor)`'s `missing_file` check scanning 1237 catalog rows across ~15 repos and returning exactly 1 hit is itself a positive-control-shaped result — a check that CAN return more than one, returning one, is different evidence than a check that structurally cannot.

**Impact:** med — prevented a wrong claim (deliberate security scrub) from reaching the user, and avoided a catalog-repair action before the underlying git shape was actually understood.

**Promote-when:** A second incident where a catalog row's target file is genuinely absent from `git ls-files` prompts checking `merge-base --is-ancestor` before characterizing why. At 2 datapoints, promote to reconnaissance `SKILL.md` Phase 1 as a named check under the existing "search that finds nothing" law (`codescout:R-3` → ... → `codescout:R-104` family) — this is that law's git-specific instance: a file's absence is evidence about which history you're looking at, not necessarily about the file's fate.

**Status:** validated — single datapoint, scout ran and the conclusion it produced (isolated orphaned commit, content preserved elsewhere) was independently corroborated by the doctor scan and the codescout tracker.

**Valid:** dated 2026-08-21

The specific commits and doctor-scan count are true as of this session; re-verify if the file is recovered or the catalog row is repaired.

**Rests on:** reconnaissance `SKILL.md` Phase 1's "a search that finds nothing is evidence about the search, not about the world" law — this is an instance of that law applied to `git log`/catalog absence rather than a code-search zero.

## F-2 — codescout's session-log template's own example Index/Wins-Index row burns the id it displays, on the very first bootstrap

**Observed:** 2026-08-21, bootstrapping `docs/trackers/repo-hygiene-session-log.md` fresh from `codescout:docs/templates/session-log.md`, then immediately calling `append_entry(id_prefix="W", ...)` for the session's first real win.

**When:** First `append_entry` call against a brand-new tracker, never previously appended to.

**Expected:** The first `append_entry` call on a fresh tracker allocates `W-1` — the template's own "How to use" prose explicitly frames `F-2`/`W-3`-style skips as something that happens to an *established* ledger whose index rows got ahead of its sections mid-use, not something that happens on bootstrap.

**Got:** The call returned `W-2`. The template ships with a literal example row in its `## Wins Index` table — `| W-1 | YYYY-MM-DD | low/med/high | <pattern> | <what-would-have-happened> | open |` — kept verbatim in the fresh copy as shown-shape documentation. The allocator counts any `PREFIX-N`-shaped text in the body toward the high-water mark, so that documentation row itself consumed `W-1` before any real entry existed. Same mechanism almost certainly applies to the `## Index` table's `| F-1 | ... |` placeholder for the F-N counter.

**Probable cause:** The allocator's high-water scan has no way to distinguish "a real claimed id" from "an example id shown as documentation" — both are `PREFIX-N` tokens in the body. The template's own explanatory precedent (`statement-validity-session-log` starting at `F-2`/`W-3`) is presented as an anomaly from mid-use index-row drift, but the true minimal case is simpler and fires on session zero: the template's own docs are, structurally, a pre-written row.

**Workaround:** None needed functionally — `W-2` is a perfectly valid id, and the ledger's high-water mark is now correctly `W-2`. Purely cosmetic: this tracker's first real win is not `W-1`.

**Severity:** low — no data loss, no broken citation, just an off-by-one-looking numbering gap on every tracker bootstrapped from this template, which could confuse a future reader auditing "why does this ledger skip W-1" without this entry to explain it.

**Status:** open

**Valid:** invariant

**Rests on:** the same allocator behavior the template's own "How to use" section already documents for mid-use index rows (`get_guide("tracker-conventions")` § Entry ids) — this entry is the bootstrap-time special case of that general rule, not a new mechanism.

**Fix idea / Pointer:** codescout `docs/templates/session-log.md` — replace the example rows' `F-1` / `W-1` tokens with a non-matching placeholder shape (e.g. `F-<n>` / `W-<n>`, which the `\b[A-Z]{1,3}-\d+\b` grammar does not match) so the documentation no longer doubles as a claim.

## Template for new entries

<!-- New F-N / W-N entries land above this line. This heading is the anchor:

     artifact(action="append_entry", id="<artifact id>", id_prefix="F",
              anchor_heading="## Template for new entries",
              title="<one-line title>", body="**Observed:** ...")

     The server allocates the id, writes `## F-N — <title>` at the ledger's
     own level, records the high-water mark and stamps `**Valid:** dated
     <today>` — one write. Then add the Index / Wins Index row with the id
     it returned. Do not hand-allocate; do not pre-write the row. -->
