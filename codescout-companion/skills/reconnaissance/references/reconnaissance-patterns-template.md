# Reconnaissance patterns — template

> **Bootstrap:** Copy this file to `docs/trackers/reconnaissance-patterns.md`
> in the active project on first recon use. The local copy then becomes
> the project's R-N ledger for the `codescout-companion:reconnaissance`
> skill. Sync mature proposals back into `SKILL.md` (see § How to sync).

---

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
| R-1 | YYYY-MM-DD | hit / miss / proposal | <one-line pattern> | `<topic>-session-log.md` F-N + W-N |

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

```python
# Cite session-log evidence; don't duplicate prose.
edit_markdown(
    path="docs/trackers/reconnaissance-patterns.md",
    action="insert_before",
    heading="## Template for new entries",
    content="## R-N — <title>\n**Verdict:** hit | miss | proposal\n..."
)
# Add a matching row to the Index table.
```

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

**Source session log:** <path or topic>, citing F-N / W-N entries.

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
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## R-N — title\n**Verdict:** ...\n...")
     Also update the Index table row at the top. -->
