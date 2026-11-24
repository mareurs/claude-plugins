# Reconnaissance patterns — template

> **Bootstrap:** follow the executable creation example and namespace preflight in
> `patterns-tracker.md`. Use the body below the fenced YAML example; keep this
> template's wrapper out of the new ledger. The creation call sets explicit
> metadata and declares the chosen prefix. A copied file can still be classified
> after reindex, but does not explicitly reserve a namespace.
>
> `R` is the example prefix below. If you selected another prefix, use it in
> entries and append calls, and record it at the top of the ledger. Sync mature
> proposals back into the skill (see § How to sync).

The fenced metadata is an example, not leading frontmatter. The bootstrap call
supplies these fields; do not copy the fence into the new artifact:

```yaml
---
kind: tracker
status: active
title: Reconnaissance patterns
entry_prefix: R
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

| ID | Date | Verdict | Pattern | Evidence (recon entry) |
|----|------|---------|---------|------------------------|
| R-<n> | YYYY-MM-DD | hit / miss / proposal | <one-line pattern> | [[<recon entry key>]], [[<recon entry key>]] |

**Cite recon entries by key** — `[[<recon entry key>]]`, the key that `box recon add`
printed (a file stem). A key names one entry in the repository, so it needs no
qualifier.

## Status vocabulary

| Verdict | Meaning |
|---------|---------|
| `hit` | Scout caught drift; subagent / implementer avoided rework. Pair with a `win` entry of the recon box. |
| `miss` | Scout did not catch drift; a downstream gate caught it. Pair with a `friction` entry of the recon box. Refines scout phases. |
| `proposal` | Vocabulary / phase expansion derived from one or more hits/misses. Lands in `SKILL.md` after threshold datapoints. |
| `promoted` | Proposal landed in `SKILL.md`. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the miss it would prevent. Pin the rationale. |

## How to append

When Phase 3 of recon produces evidence about the skill itself, capture it here
in addition to the recon-box entry. Set `tracker_id` from the bootstrap
result (or the existing ledger's catalog id), `prefix` to its declared namespace,
`entry_title` to a short title, and `entry_body` from the entry template below.

Let the server allocate the id, write its section, and add the Index row in one
call. Do not reserve a row or allocate an id by hand: the catalog's reservation serialises
concurrent calls on a checkout that has not opted in, the checkout write lock on an opted-in
one. The bootstrap declares the
Index header as `snapshot_anchor`, so this row lands at that table's tail:

```python
entry = doc(action="append_entry", id=tracker_id, id_prefix=prefix,
            anchor_heading="## Template for new entries",
            title=entry_title, body=entry_body,
            index_row="| {id} | YYYY-MM-DD | hit / miss / proposal | <one-line pattern> | [[<recon entry key>]] |")
```

Fill the row's date, verdict, pattern and evidence for the observation. Keep the
`{id}` placeholder: the server substitutes the allocated id atomically.
Declaring `entry_prefix` guards the ledger against `edit_file`; use
the surgical `patch.body_edits` field of the `doc` update action for prose or
existing-row corrections. `append_entry` allocates ids; it is not the only writer.

## How to sync

When an R-N proposal reaches its promote-when threshold, sync it into
the skill itself:

1. Open a PR (or change) against the `codescout-companion` repo,
   specifically `skills/reconnaissance/SKILL.md`.
2. The PR description references the R-N entries + their host
   recon-box entries (`[[<entry key>]]`) by key.
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

**Source recon entry:** [[<recon entry key>]]

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

<!-- Insert new entries above this heading through the documented append call.
     Use the ledger's declared prefix, not an assumed R. That call writes the
     section and Index row together. Prose edits use doc(update, body_edits),
     because the bootstrapped ledger is guarded from creation. -->
