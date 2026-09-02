# Reconnaissance patterns — template

> **Bootstrap:** create `docs/trackers/reconnaissance-patterns.md` in the active
> project on first recon use, using the body below. It becomes that project's R-N
> ledger for the `codescout-companion:reconnaissance` skill. Sync mature proposals
> back into `SKILL.md` (see § How to sync).
>
> **Do not `cp` this file.** The frontmatter below is fenced so this template is
> not itself classified as an artifact — a literal copy therefore produces a
> ledger with *no* frontmatter: no `kind`, no `status`, and no librarian row.
> Create it through the catalog instead, which registers it in the same call:
>
> ```python
> artifact(action="create", kind="tracker", title="Reconnaissance patterns",
>          rel_path="docs/trackers/reconnaissance-patterns.md",
>          topic="reconnaissance", tags=["reconnaissance", "skill-meta", "scout"],
>          body="<everything below the frontmatter block>")
> ```
>
> **Check the prefix is free before you claim it.** `grep -rnE '\bR-[0-9]+\b' docs/`.
> If another artifact already writes `R-N` — even in table rows, which define no
> citable token and are therefore *invisible* to `link_scan` until you make the
> prefix live — take a free prefix (`RP-`) and say so at the top of the ledger.
> See § *Bootstrap wakes a whole namespace* in `patterns-tracker.md`.

---

The frontmatter for the new ledger — pass these as `artifact(action="create")`
parameters rather than copying the block:

```yaml
---
kind: tracker
status: active
title: Reconnaissance patterns
owners: []
tags:
  - reconnaissance
  - skill-meta
  - scout
---
```

# Reconnaissance patterns

Per-project aggregator for observations about the
`codescout-companion:reconnaissance` skill *as used in this project*.
Each entry is an R-N record with a verdict + evidence. Three buckets:

- **Hits** — scout caught drift before dispatch, saved measurable cost.
- **Misses** — scout failed to surface drift; a downstream gate (spec
  review, code review, `cargo build`, runtime) caught it instead.
- **Pattern proposals** — vocabulary / phase expansions ready to
  promote into `SKILL.md` once threshold datapoints land.

Entries are monotonic per project; never reuse or skip an ID. Default
promote-when threshold is **3 datapoints**, unless the entry argues
otherwise.

## Why per project, not global

Recon patterns are project-shaped: a Rust workspace's blast-radius
question (struct-field threading, trait-method addition) differs
from a TypeScript monorepo's (barrel re-exports, generated types).
Per-project R-N ledgers keep the lessons close to the substrate that
produced them. Cross-project lessons graduate via the sync flow.

## Index

| ID | Date | Verdict | Pattern | Evidence (session-log) |
|----|------|---------|---------|------------------------|
| R-<n> | YYYY-MM-DD | hit / miss / proposal | <one-line pattern> | <topic>-session-log:F-<n>, <topic>-session-log:W-<n> |

**Cite session-log entries in the qualified form** — `<file-stem>:F-<n>`, colon, no
space, no `.md`. A bare `F-<n>` is resolved against the whole workspace, and F/W
counters are per-work-stream, so every session log in the project defines the same
low numbers: the citation comes back ambiguous and resolves to nothing. A filename
and a token separated by whitespace is prose, not a citation.

## Status vocabulary

| Verdict | Meaning |
|---------|---------|
| `hit` | Scout caught drift; subagent / implementer avoided rework. Pair with a W-N in the source session log. |
| `miss` | Scout did not catch drift; a downstream gate caught it. Pair with an F-N in the source session log. Refines scout phases. |
| `proposal` | Vocabulary / phase expansion derived from one or more hits/misses. Lands in `SKILL.md` after threshold datapoints. |
| `promoted` | Proposal landed in `SKILL.md`. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the miss it would prevent. Pin the rationale. |

## How to append

When Phase 3 of a recon scout produces evidence about the *skill itself*
(not just the work stream), capture it here in addition to the
work-stream session log:

Let the server allocate the id and write the section in the same call — do not hand-allocate by grepping the file, and do not pre-write the Index row (a pre-written row consumes the id it names):

```python
# Cite session-log evidence; don't duplicate prose.
artifact(action="append_entry", id="<tracker artifact id>", id_prefix="R",
         anchor_heading="## Template for new entries",
         title="<title>", body="**Verdict:** hit | miss | proposal\n...")
# Add a matching row to the Index table, using the id the call returned.
```

`edit_markdown` is not the append path, though it works at first: this template ships without `entry_prefix`, so a fresh copy is directly editable — but once `entry_prefix` is declared to guard the ledger (`get_guide("tracker-conventions")` § *Make the tracker guarded*), the librarian guard refuses direct edits and only `append_entry` writes. Reach for `edit_markdown` for the prose sections and the Index table, never for allocating an entry.

## How to sync

When an R-N proposal reaches its promote-when threshold, sync it into
the skill itself:

1. Open a PR (or change) against the `codescout-companion` repo,
   specifically `skills/reconnaissance/SKILL.md`.
2. The PR description references the R-N entries + their host
   session-log F-N / W-N evidence by name.
3. After merge, edit the R-N entry in the project tracker:
   set `Verdict: promoted` and pin the commit SHA + skill version
   in the entry body.
4. Other projects pick up the change on next skill update.

This is a manual flow — no automated cross-project aggregation. The
skill is the canonical destination; per-project trackers are the
substrate that earns its way in.

## R-N entry template

```markdown
## R-N — <one-line title>

**Verdict:** hit | miss | proposal | promoted | wontfix

**Observed:** <date, work-stream name>

**Source session log:** <topic>-session-log:F-<n> (qualified — a bare token is
ambiguous across work streams).

**Pattern (or pattern that failed):** <one paragraph — what the scout
did / didn't do, and why the outcome happened>.

**Evidence:** <concrete cost or saved cost — round-trips, tests that
would have failed, files that would have been wrongly edited>.

**Pattern proposal (if any):** <the SKILL.md change that would prevent
this miss / institutionalize this hit>.

**Promote-when:** <criterion — usually N more datapoints of the same
shape; can be 1 if the proposal is cheap and clearly correct>.
```

---

## Template for new entries

<!-- Insert new R-N entries above this line via:
     artifact(action="append_entry", id="<tracker artifact id>", id_prefix="R",
              anchor_heading="## Template for new entries",
              title="title", body="**Verdict:** ...\n...")
     Also update the Index table row at the top, using the id the call
     returned. `edit_markdown` is refused once entry_prefix guards the
     ledger — it only works on an unguarded fresh copy. -->
