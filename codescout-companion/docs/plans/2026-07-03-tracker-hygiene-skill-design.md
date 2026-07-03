# Tracker Hygiene Skill — Design

**Date:** 2026-07-03
**Status:** approved design, pre-implementation
**Home:** `codescout-companion/skills/tracker-hygiene/` (sibling of `reconnaissance`)

## Problem

Tracker corpora drift, and the drift survives even formal consolidation efforts:

- **backend-kotlin** ran a full tracker consolidation on 2026-05-21 (cluster-map
  README, CONVENTIONS.md, archive/ flow). Six weeks later, 6 tracker files created
  since the consolidation are absent from the README cluster map
  (`chat-eval-session-log`, `iel-prod-solver-config`,
  `innovaplan-reconciliation-session-log`, `personalizzazione-subject-teacher-remodel`,
  `solver-trace-persistence-session-log`, `bulk-delete-lessons-session-log`) — even
  though the README was touched the day before this design was written. Drift here
  is not neglect; it is *incomplete upkeep* — the map gets patched for the change at
  hand, never audited as a whole.
- **codescout**'s archive-cadence policy schedules a "manual quarterly pass"; the
  Q2 pass (due 2026-06-30) did not happen. The verify-open pass of 2026-05-25 found
  a **75% zombie-open rate** in one session log (3 of 4 nominally-open entries were
  already fixed).

Root cause in both repos is the same: **fix-then-forget**. Closures happen under
commits that never name the tracker entry, so no gate trips. Existing mechanisms
are narrower than the problem: `archive-cadence-policy.md` covers only archive
eligibility for U/H/R-N trackers; `librarian(audit_doc_refs)` covers stale *code*
references in docs, not tracker lifecycle; the verify-open cadence is one prose
note in one CLAUDE.md.

## Decisions (locked during brainstorm, 2026-07-03)

1. **Standalone sibling skill** next to `reconnaissance` — not a recon mode.
   Recon is per-task (compare plan vs reality before an edit); hygiene is a
   periodic corpus-wide sweep. They compose; they don't share a trigger.
2. **Audit + gated fix** — the sweep proposes; a human disposes. No report-only
   mode (reports without an apply path become their own stale artifact), no
   auto-apply in v1.
3. **Trackers first, layered** — v1 is file-level over `docs/trackers/`.
   Entry-level checks and `docs/issues/` discipline are v2, named now.
4. **Manual + SessionStart nudge** — invoked by hand; a ledger records
   `next-sweep-due` and the companion's SessionStart hook surfaces one overdue
   line. Purely-manual cadence demonstrably fails (see Problem).
5. **Detection method: declared-vs-observed diff** — the skill learns each
   project's conventions, then diffs what the project *says* about its trackers
   against what *is* true. Named detectors form the skeleton; their parameters
   derive from the project's own convention docs, not hardcoded layouts.
6. **Every fix individually gated in v1**; trust is earned per detector from
   logged evidence (see Graduation rule).
7. **The sweep audits itself** — a per-project ledger logs findings, verdicts,
   and reject reasons; HY-N meta-entries drive skill improvement, mirroring
   recon's R-N pattern.

## Method — the three states

Drift is, by definition, a disagreement between three kinds of truth a project
already holds:

| State | What it is | Sources |
|---|---|---|
| **Convention** | The local dialect: what statuses mean, where terminal things go, what the index format is | `CONVENTIONS.md`, `TAXONOMY.md`, `archive-cadence-policy.md`, `get_guide("tracker-conventions")` defaults |
| **Declared** | What the project *says* is true | index/README cluster maps, frontmatter `status:`, canonical/child claims |
| **Observed** | What *is* true | `git log -1` per file, actual directory (live vs `archive/`), librarian catalog rows, `artifact_refresh(list_stale)` |

The sweep reads Convention to parameterize the detectors, builds Declared and
Observed, and diffs them. Every finding carries an **evidence pair** ("README
lists 16 live solving trackers; directory holds 22 — these 6 are unmapped") and
a proposed fix.

## The loop — five phases

1. **Learn** — read the project's convention surfaces (index file, conventions
   doc, archive policy, status vocabularies). No hardcoded repo layout. If no
   conventions exist: announce it, run the thin sweep (frontmatter + filesystem
   only), and emit a finding recommending a conventions bootstrap.
2. **Inventory** — build Declared (index rows, frontmatter) and Observed
   (`git log -1 --format=%ad` per tracker file, directory placement,
   `artifact(find, kind="tracker", include_archived=true)`,
   `artifact_refresh(action="list_stale")`).
3. **Diff** — run the detector set. Each finding: detector name, evidence pair,
   proposed fix, confidence note.
4. **Triage** — interactive, one finding at a time (`AskUserQuestion`).
   Verdicts: **approve** / **reject** (one-line reason mandatory — it is the
   training signal) / **defer** (resurfaces next sweep). Nothing is edited
   before its verdict.
5. **Apply + Log** — approved fixes go through the librarian
   (`artifact(update)` / `artifact(move)` — never bare `git mv`, which orphans
   the catalog row). Append one sweep entry to the ledger; one commit for the
   fixes, referencing the sweep entry, citation-format compliant.

## Detector set

### v1 (six detectors)

| ID | Name | Detects | Fix shape | Confidence |
|---|---|---|---|---|
| **D1** | index-drift | Live files absent from the declared index; index rows pointing at missing/moved files | add/repoint index row | high |
| **D2** | terminal-not-archived | Frontmatter `archived`/`superseded` (or terminal body marker) but file in live dir; or file in `archive/` with `status: active` | `artifact(update)` + `artifact(move)` per project archive policy | high |
| **D3** | stale-active | `status: active` and no git touch in N days (N from project archive policy; default 45) | a *question* — archive, or confirm still-live? Never a presumed archive | low, by design |
| **D4** | frontmatter-catalog-mismatch | Librarian catalog row disagrees with file frontmatter (hand edits, `git mv` orphans, missing `kind:`) | reconcile via librarian; `librarian(reindex)` for orphans | high |
| **D5** | canonical-conflict | Two live trackers claim one topic, or a child restates the canonical's status (violates "one canonical per topic") | judgment call, always | low |
| **D9** | augmentation-stale | Augmented artifacts whose last refresh exceeds threshold, via `artifact_refresh(action="list_stale")` | run the gather → synthesize → `commit_refresh` cycle, or flag for owner | medium |

D3 is deliberately the noisiest detector — quiet ≠ dead — and therefore the most
valuable to tune through logged rejects.

(D9 carries its original number from the draft detector list; it was promoted
into v1 during design review because `artifact_refresh(list_stale)` makes it
nearly free. D6–D8 remain v2.)

### v2 (named now, not built)

- **D6** entry-level verify-open — zombie-open F-N/U-N/W-N entries inside session
  logs (the 75%-zombie problem), needs per-prefix status vocabularies.
- **D7** citation-format violations — bare SHAs without branch scope.
- **D8** `docs/issues/` archive discipline — `fixed` bugs whose fix is on master
  (`git branch --contains`) but file not yet in `archive/`.

## Gating model & graduation rule

- **v1:** every finding individually gated. No batch approval. No auto-apply.
- **Graduation (mechanical, written into the SKILL.md):** a detector earns
  batch-approval mode after **two consecutive sweeps with zero rejects** for
  that detector. Any reject drops it back to individual gating. Auto-apply is
  out of scope entirely until batch mode has a track record.
- Trust is a per-detector property earned from ledger evidence, never assumed.

## The sweep ledger

Per adopting project: `docs/trackers/tracker-hygiene-log.md`, bootstrapped from
`references/tracker-hygiene-log-template.md` in the skill (same pattern as
recon's `reconnaissance-patterns-template.md`).

**Frontmatter:** `kind: tracker`, `status: active`, plus
`next-sweep-due: YYYY-MM-DD` and `sweep-interval-days: 30` (per-project
override).

**Per-sweep entry:**
- date, scope, files inventoried
- per-detector: findings / approved / rejected / deferred, each reject's reason
- fixes applied, with commit SHA in the project's citation format
- computed `next-sweep-due` (frontmatter updated in the same edit)

**HY-N meta-entries** (skill self-improvement, mirrors recon's R-N):
- `hit` — detector caught real drift, human approved
- `miss` — drift found manually that no detector flagged (the most important kind)
- `false-positive-pattern` — recurring reject reason → detector tuning proposal
- `proposal` — concrete SKILL.md change

**Promote-when:** an HY-N proposal confirmed across 2+ sweeps → PR against the
skill, citing HY-N IDs — the same sync flow recon uses for R-N. Cross-project by
design: each repo's ledger feeds the one skill.

## SessionStart nudge

The companion's SessionStart hook gains one cheap check: read `next-sweep-due:`
from `docs/trackers/tracker-hygiene-log.md` frontmatter (single file read, no
git). If overdue, emit one banner line:

```
tracker hygiene overdue (due 2026-08-02) — /codescout-companion:tracker-hygiene
```

File absent → silent (project has not adopted the skill). The nudge never runs
detection itself — detection costs git + librarian calls and belongs to an
explicit invocation.

## Degradation & edge cases

- **No convention docs** → thin sweep (frontmatter vs filesystem only) + a
  finding recommending a conventions bootstrap.
- **Librarian catalog unavailable/empty** → D4 and D9 skip; noted in the ledger
  entry so the gap is visible.
- **Interrupted sweep** → harmless by construction: nothing applies ungated, the
  ledger writes at the end, and findings are **recomputed each sweep** rather
  than persisted as stateful items. A deferred or lost finding simply reappears.
- **Multi-workspace sessions** → pin `workspace=` per call per the
  workspace-state rules; never `activate` a foreign project mid-sweep.

## Growth path

1. **v2 detectors** D6–D8 once the file-level sweep is trusted.
2. **Batch approval** per detector via the graduation rule.
3. **Substrate promotion:** once D1/D2/D4 hold zero-reject records, their
   mechanical detection graduates to a Rust `librarian(action="audit_trackers")`
   beside `audit_doc_refs` / `legibility_scan`; the skill then consumes its
   output and keeps only triage and judgment in skill-land. Same ladder the
   ecosystem already uses (U-N → H-N → shipped hook).

## Validation

- **Acceptance = the first two live sweeps, with known ground truth:**
  1. **backend-kotlin** — must catch at minimum the 6 unmapped trackers (D1)
     and exercise D2/D3 against the 22-file live dir.
  2. **codescout** — the overdue Q2 archive pass (D2/D3) and augmented
     artifacts (D9).
  Both runs seed the first HY-N entries.
- **Optional pre-ship:** a trigger-scenario eval for the SKILL.md description,
  mirroring `docs/evals/reconnaissance-trigger.md` (recon's empirical baseline
  practice).

## Out of scope

- `docs/issues/` bug files (v2, D8)
- Entry-level statuses inside trackers (v2, D6)
- Auto-apply of any fix
- Automated/scheduled detection (the nudge reads one frontmatter field; it never
  sweeps)
- Cross-project aggregation infrastructure (ledgers are per-project; the skill
  is the only shared surface)
