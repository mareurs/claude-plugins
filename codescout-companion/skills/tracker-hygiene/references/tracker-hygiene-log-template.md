# Tracker hygiene log — template

> **Bootstrap:** Copy this file to `docs/trackers/tracker-hygiene-log.md`
> in the active project on first sweep. The local copy becomes the
> project's sweep ledger + HY-N meta-ledger for the
> `codescout-companion:tracker-hygiene` skill. Set `next-sweep-due` to
> today before the first sweep. Sync mature HY-N proposals back into
> `SKILL.md` (see § How to sync).

---

```yaml
---
kind: tracker
status: active
title: Tracker hygiene log
owners: []
tags:
  - hygiene
  - skill-meta
  - lifecycle
next-sweep-due: YYYY-MM-DD
sweep-interval-days: 30
---
```

# Tracker hygiene log

Per-project ledger for the `codescout-companion:tracker-hygiene` skill.
Two kinds of entries live here:

- **Sweep entries** (`## Sweep YYYY-MM-DD`) — one per sweep: per-detector
  findings/verdicts, every reject's reason, fixes applied with commit SHA.
- **HY-N meta-entries** (`## HY-N — <title>`) — observations about the
  *skill itself*: detector hits, misses, false-positive patterns, and
  SKILL.md change proposals. Monotonic per project; never reuse an ID.

The frontmatter `next-sweep-due:` field is read by the companion's
SessionStart hook — an overdue date produces a one-line nudge at session
start. Every sweep entry ends by updating it to
`sweep date + sweep-interval-days`.

## Detector trust state

Batch-approval graduation is per detector, earned from this table.
A detector enters `batch` after **two consecutive sweeps with zero
rejects**; any reject drops it back to `individual`.

| Detector | Mode | Consecutive zero-reject sweeps | Last reject (sweep, reason) |
|----------|------|-------------------------------|------------------------------|
| D1 index-drift | individual | 0 | — |
| D2 terminal-not-archived | individual | 0 | — |
| D3 stale-active | individual | 0 | — |
| D4 frontmatter-catalog-mismatch | individual | 0 | — |
| D5 canonical-conflict | individual | 0 | — |
| D9 augmentation-stale | individual | 0 | — |

## HY-N verdict vocabulary

| Verdict | Meaning |
|---------|---------|
| `hit` | Detector caught real drift; human approved the fix. |
| `miss` | Drift found manually that no detector flagged. The most important kind — drives new detectors. |
| `false-positive-pattern` | Recurring reject reason for one detector — carries a tuning proposal. |
| `proposal` | Concrete SKILL.md change derived from the above. |
| `promoted` | Proposal landed in SKILL.md. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the drift it would prevent. Pin the rationale. |

## How to sync

When an HY-N proposal is confirmed across **2+ sweeps** (same shape,
either sweep in this project or a sibling project's ledger), sync it
into the skill:

1. PR against `codescout-companion/skills/tracker-hygiene/SKILL.md`,
   citing the HY-N IDs and their sweep entries.
2. On merge, set the HY-N entry to `Verdict: promoted` and pin the
   commit SHA + plugin version.

Manual flow — no automated cross-project aggregation. The skill is the
canonical destination; per-project ledgers are the substrate.

## Sweep entry template

```markdown
## Sweep YYYY-MM-DD

**Scope:** docs/trackers/ | **Files inventoried:** N | **Convention sources:** <index file, conventions doc, or "none — thin sweep">

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 0 | 0 | 0 | 0 |
| D2 terminal-not-archived | 0 | 0 | 0 | 0 |
| D3 stale-active | 0 | 0 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 0 | 0 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 0 | 0 | 0 | 0 |

**Rejects (verbatim reasons — the training signal):**
- <detector>: "<finding one-line>" → rejected: <reason>

**Fixes applied:** <commit ref in the project's citation format, e.g. `(master:<sha>)`>

**Detector trust updates:** <rows changed in the trust table, or "none">

**Next sweep due:** YYYY-MM-DD (frontmatter updated in this edit)
```

## HY-N entry template

```markdown
## HY-N — <one-line title>

**Verdict:** hit | miss | false-positive-pattern | proposal | promoted | wontfix

**Sweep:** YYYY-MM-DD (this ledger) — or cite sibling project ledger.

**Observation:** <what the detector did / didn't do, and the human verdict>.

**Proposal (if any):** <the SKILL.md or detector change>.

**Promote-when:** <criterion — default: same shape confirmed across 2+ sweeps>.
```

---

## Template for new entries

<!-- Insert new sweep entries and HY-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## Sweep YYYY-MM-DD\n...")
     Update frontmatter in the same call:
     edit_markdown(..., frontmatter={set: {"next-sweep-due": "YYYY-MM-DD"}}) -->
