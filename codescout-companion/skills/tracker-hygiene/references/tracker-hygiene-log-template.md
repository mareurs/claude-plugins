# Tracker hygiene — templates for the hygiene box

Templates for `codescout box hygiene add`, the box of the `codescout-companion:tracker-hygiene` skill. Sync mature `meta` proposals back into `SKILL.md` (§ How to sync).

## Box readme

Make the box with `codescout box new worklog hygiene --title "Tracker hygiene sweeps" --exit-when "the repository stops running tracker hygiene"`. Then set its readme frontmatter to `entry_kinds: [sweep, meta]` and the field `next_sweep_due` with `type: scalar`, and keep the statuses `open`, `done`, `promoted`, `dropped`. Keep the readme body under 2000 bytes (`codescout box hygiene check`). The body says: a `sweep` is filed with `--status done`, its body ends with the detector trust table, and its frontmatter field `next_sweep_due` is the sweep date plus 30 days; the newest `sweep` entry is the state of the project; a `meta` entry is an observation about the skill and starts with `**Verdict:**`.

## Detector trust table (default)

Batch-approval graduation is per detector, earned from this table. A detector enters `batch` after **two consecutive advancing sweeps**: a sweep advances only if the detector fired and every finding was approved (zero rejects, zero defers). Any reject resets to `individual`; a no-finding or deferred sweep is neutral (streak unchanged). Copy the table into every sweep entry, with the updated values.

| Detector | Mode | Consecutive zero-reject sweeps | Last reject (sweep, reason) |
|----------|------|-------------------------------|------------------------------|
| D1 index-drift | individual | 0 | — |
| D2 terminal-not-archived | individual | 0 | — |
| D3 stale-active | individual | 0 | — |
| D4 frontmatter-catalog-mismatch | individual | 0 | — |
| D5 canonical-conflict | individual | 0 | — |
| D9 augmentation-stale | individual | 0 | — |
| D10 session-log-decay | individual | 0 | — |
| D11 promotion-pointer drift | individual | 0 | — |

## Verdict vocabulary of a `meta` entry

| Verdict | Meaning |
|---------|---------|
| `hit` | Detector caught real drift; human approved the fix. |
| `miss` | Drift found manually that no detector flagged. The most important kind — drives new detectors. |
| `false-positive-pattern` | Recurring reject reason for one detector — carries a tuning proposal. |
| `proposal` | Concrete SKILL.md change derived from the above. |
| `promoted` | Proposal landed in SKILL.md. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the drift it would prevent. Pin the rationale. |

## How to sync

When a `meta` proposal is confirmed across **2+ sweeps** (same shape, in this project or in a sibling project's box), sync it into the skill:

1. PR against `codescout-companion/skills/tracker-hygiene/SKILL.md`, citing the entry keys and their sweep entries.
2. On merge, end the `meta` entry with `promoted` and the line `**Promoted to:** <commit SHA>, plugin version <X.Y.Z>`.

Manual flow — no automated cross-project aggregation. The skill is the canonical destination; per-project boxes are the substrate.

## Sweep entry template

```markdown
**Scope:** docs/trackers/ | **Files inventoried:** N | **Convention sources:** <index file, conventions doc, or "none — thin sweep">

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 0 | 0 | 0 | 0 |
| D2 terminal-not-archived | 0 | 0 | 0 | 0 |
| D3 stale-active | 0 | 0 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 0 | 0 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 0 | 0 | 0 | 0 |
| D10 session-log-decay | 0 | 0 | 0 | 0 |

**Rejects (verbatim reasons — the training signal):**
- <detector>: "<finding one-line>" → rejected: <reason>

**Fixes applied:** "this commit" (a sweep entry can't cite its own commit's SHA); use the project's citation format for any *external* SHA.

**Detector trust table after this sweep:** <the full table, with the updated rows>

**Next sweep due:** YYYY-MM-DD (the `next_sweep_due` field of this entry)
```

## Meta entry template

```markdown
**Verdict:** hit | miss | false-positive-pattern | proposal | promoted | wontfix

**Sweep:** YYYY-MM-DD (this box) — or cite a sibling project's box.

**Observation:** <what the detector did / didn't do, and the human verdict>.

**Proposal (if any):** <the SKILL.md or detector change>.

**Promote-when:** <criterion — default: same shape confirmed across 2+ sweeps>.
```
