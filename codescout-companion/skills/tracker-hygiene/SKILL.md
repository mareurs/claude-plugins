---
name: tracker-hygiene
description: Use when asked to run a tracker hygiene sweep, audit tracker staleness or drift, clean up docs/trackers, before backlog triage or any "what's open?" report, or when the SessionStart banner says a tracker hygiene sweep is overdue. Interactive — every finding is human-gated; approved fixes apply via the librarian; each sweep appends to the project's tracker-hygiene-log.
---

# /codescout-companion:tracker-hygiene

Tracker corpora drift even after formal consolidation: index maps miss new
files, terminal trackers linger in live directories, "active" frontmatter
outlives the work. Drift is a **disagreement between three states** the
project already holds — this skill diffs them and lets a human gate every
fix.

| State | What it is | Where it lives |
|---|---|---|
| **Convention** | The local dialect: status vocabularies, archive dir, index format | `CONVENTIONS.md`, `TAXONOMY.md`, archive policy docs, `get_guide("tracker-conventions")` defaults |
| **Declared** | What the project *says* is true | index/README cluster maps, frontmatter `status:` |
| **Observed** | What *is* true | `git log -1` per file, actual directory, librarian catalog, `artifact_refresh(list_stale)` |

**REQUIRED SUB-SKILL:** None. Composes with `reconnaissance` (per-task
drift-catching; this skill is the corpus-wide periodic sweep).

## When to Use

- Explicitly invoked, or the SessionStart banner says a sweep is overdue.
- Before backlog triage or any "what's open?" report.
- When recon or any session notices corpus-level drift (orphaned trackers,
  index rows pointing nowhere).

## When NOT to Use

- Mid-task single-tracker updates — that's normal editing.
- Single-bug archive moves — the project's ship sequence covers those.
- Anything in `docs/issues/` — bug-file discipline is v2 (D8), not yet here.

## The loop — five phases

### Phase 1 — Learn

Read the project's convention surfaces to parameterize the detectors. Look
for, in order: a tracker index (`docs/trackers/README.md`, `docs/TAXONOMY.md`),
a conventions doc (`docs/trackers/CONVENTIONS.md`), an archive policy
(`docs/trackers/archive-cadence-policy.md` or equivalent). Extract: the
index format, the archive directory, status vocabularies, the staleness
threshold N (default **45 days** if none declared).

If no convention docs exist: announce it, run the **thin sweep** (D2/D3/D4/D9
only — no index to diff), and emit a synthetic finding recommending a
conventions bootstrap.

If the ledger `docs/trackers/tracker-hygiene-log.md` does not exist,
bootstrap it now from `references/tracker-hygiene-log-template.md`. The
template stores its frontmatter inside a fenced ```yaml sample, so you must
convert it into a REAL top-of-file frontmatter block: delete everything
above that fenced block — the `# Tracker hygiene log — template` title, the
bootstrap blockquote, and the fence markers themselves — so the file begins
at byte 0 with `---` on line 1, then `kind: tracker`, `status: active`, … .
Set `next-sweep-due` to today and keep `sweep-interval-days` (default 30).
Verify with `head -1` that the first line is exactly `---`; if it is not,
the librarian will not catalog the ledger as a tracker (making it invisible
to this skill's own Phase 2 inventory) and Phase 5's frontmatter update will
synthesize a duplicate block. The file body (from the `# Tracker hygiene
log` H1 downward) is copied as-is.

### Phase 2 — Inventory

Build both states. All shell via `run_command`; never pipe unbounded output.

- **Observed dates:** `for f in $(git -C <root> ls-files 'docs/trackers/*.md'); do echo "$(git -C <root> log -1 --format=%ad --date=short -- "$f")  $f"; done`
- **Observed placement:** which files sit in the live dir vs the archive dir.
- **Observed catalog:** `artifact(action="find", kind="tracker", include_archived=true)` — note rows whose `status` or `rel_path` disagree with disk. This query is project-wide: it returns trackers **anywhere** in the project, including outside `docs/trackers/` (e.g. a subproject's `*/docs/*_TRACKER.md`). The file inventory above only sees `docs/trackers/` — so the two halves disagree on scope. Treat `docs/trackers/` as the sweep's authoritative scope; a catalog tracker living elsewhere is a *separate observation*, not a D1 index-drift finding. (If you reach for `librarian(action="doctor")` to find orphans, note it scans the **whole catalog across all projects** — filter its `missing_file` violations to this project's path.) `kind=tracker` can also return mis-classified `docs/issues/` bug files (a bug file carrying `kind: tracker`) — exclude `docs/issues/` from the cross-check; bug-file lifecycle is D8/v2.
- **Observed augmentation freshness:** `artifact_refresh(action="list_stale", threshold_hours=168)`.
- **Declared:** parse the index file's rows (file links + claimed status); read each tracker's frontmatter `status:` via `read_markdown`.

### Phase 3 — Diff (the detectors)

Run each detector; emit findings as `(detector, evidence pair, proposed fix,
confidence)`. An evidence pair always names both sides: *"declared X;
observed Y"*.

| ID | Name | Fires when | Proposed fix | Confidence |
|---|---|---|---|---|
| **D1** | index-drift | Live file absent from the index, or index row points at a missing/moved file | add or repoint the index row — *which* cluster/section is a per-file placement judgment, so gate the placement, not just the add | high |
| **D2** | terminal-not-archived | Frontmatter `archived`/`superseded` but file in live dir; or file in archive dir with `status: active` | `artifact(update, patch={status:...})` + `artifact(move, new_rel_path=...)` per the project's archive policy | high |
| **D3** | stale-active | `status: active` and no git touch in N days | **a question** — archive, or confirm still-live? Never presume archive | low, by design |
| **D4** | frontmatter-catalog-mismatch | Catalog row disagrees with file frontmatter, or file has no catalog row / no `kind:` | reconcile via `artifact(update)`; `librarian(action="reindex")` for orphans | high |
| **D5** | canonical-conflict | Two live trackers claim one topic (tag/topic overlap + index cluster), or a child restates its canonical's status | judgment call — merge, link, or bless the fork | low |
| **D9** | augmentation-stale | `artifact_refresh(list_stale)` returns the artifact | refresh **only if mechanical**, else defer to owner (see the D9 rule below) — never fabricate | medium |

D6 (entry-level verify-open), D7 (citation format), D8 (`docs/issues/`
discipline) are **v2** — do not improvise them mid-sweep; a drift you notice
outside D1–D5/D9 is a `miss` HY-N entry, which is how v2 earns its way in.

**D9 defer-vs-refresh — default to defer.** Before synthesizing a D9 refresh, read
the augmentation's own prompt. Auto-refresh **only** when that prompt describes a
mechanical, gather-driven body ("summarize recent commits," a status rollup) — one
you can regenerate from the gathered context without domain judgment. If the prompt
is append-only or domain-expert (invariants, decisions, judgment-authored lessons —
e.g. an `SI-N` solving-invariants registry), or you are unsure, **defer to the
owner**: record the finding, do NOT synthesize entries, and do NOT reset the
staleness clock (it should re-surface next sweep). Fabricating into a domain
registry is the worst outcome; deferring a mechanical one only costs a re-run.

### Phase 4 — Triage (interactive, one finding at a time)

Check the ledger's **Detector trust state** table first. For detectors in
`individual` mode (v1 default: all), present each finding as its own
`AskUserQuestion`: the evidence pair, the proposed fix, the detector name.
**Batching homogeneous findings:** when a detector produces several findings that
share one fix shape (e.g. many D1 "add index row"), you may present them as a
single gate listing every finding with a *per-item* approve/reject/defer, instead
of one question each — presentation only, not auto-approval; every finding still
gets its own verdict. Keep strict one-at-a-time for judgment-heavy detectors
(D3, D5) and any detector whose fixes differ per finding.
Verdicts:

- **approve** — fix applies in Phase 5.
- **reject** — false positive. A one-line reason is mandatory; it is the
  training signal. Record it verbatim.
- **defer** — no action; the finding recomputes and resurfaces next sweep.

For detectors that have graduated to `batch` mode, present all of that
detector's findings as one batch gate (same per-item verdicts). Auto-apply does
not exist at any trust level.

**What advances graduation.** A sweep advances a detector's streak *only if the
detector produced ≥1 finding and every one was approved* (zero rejects, zero
defers). Any reject resets the streak to 0 and drops the detector back to
`individual`. A no-finding sweep, or any sweep with a deferral, is **neutral** —
the streak is unchanged (no evidence the detector fired *and was right*). Batch
mode is earned after two consecutive advancing sweeps; update the trust table in
Phase 5.

Nothing is edited before its verdict.

### Phase 5 — Apply + Log

- Apply approved fixes **through the librarian** — `artifact(update)`,
  `artifact(move)` — never bare `git mv`, which orphans the catalog row
  (`id = sha256(abs_path)`).
- Append one sweep entry to the ledger (template in the ledger file) via
  `edit_markdown(action="insert_before", heading="## Template for new entries", ...)`;
  in the same call set the frontmatter:
  `frontmatter={set: {"next-sweep-due": "<today + sweep-interval-days>"}}`.
- Update the Detector trust state table (zero-reject streaks, demotions).
- Add HY-N entries for anything meta: a `miss` (drift found outside the
  detectors), a `false-positive-pattern` (recurring reject reason), a
  `proposal`.
- One commit for the whole sweep, message referencing the sweep entry. Cite
  SHAs in the project's citation format for *external* references; the sweep
  entry cannot cite its own commit's SHA (it lives inside that commit) — write
  "this commit" there.

## Degradation rules

- **No convention docs** → thin sweep + bootstrap-recommendation finding.
- **Librarian unavailable / catalog empty** → skip D4 and D9; say so in the
  sweep entry, so the gap is visible rather than silent.
- **Interrupted sweep** → safe by construction: nothing applies ungated,
  the ledger writes at the end, findings recompute next sweep.
- **Foreign-project sweep (target ≠ session home)** → the catalog detectors
  (D4, D9) run via `artifact()` / `artifact_refresh()`, which query only the
  ACTIVE project and take **no** `workspace=` param. So you MUST
  `workspace(action="activate", path=<target>, read_only=false)` before Phase 2,
  and confirm the response shows `read_only: false` — a read-only activation
  blocks Phase 5 apply and the ledger bootstrap. Restore the home project before
  the turn ends (`get_guide("workspace-state")`). Pinning `workspace=` reaches only
  the file-based detectors (D1/D2/D3 via `run_command`/`read_markdown`), never the
  catalog — so a pinned-not-activated sweep silently runs at most half the detectors.

## Stop conditions

- The user rejects three findings in a row from the same detector — stop
  presenting that detector's findings this sweep, log a
  `false-positive-pattern` HY-N, move on.
- More than ~25 findings total — present counts per detector first and ask
  which detectors to triage this session; the rest defer.

## The ledger (per project)

`docs/trackers/tracker-hygiene-log.md`, bootstrapped from this skill's
`references/tracker-hygiene-log-template.md`. Holds sweep entries, HY-N
meta-entries, and the detector trust table. The companion's SessionStart
hook reads its `next-sweep-due:` frontmatter and nudges when overdue —
keeping that field current is part of every sweep's Phase 5.

HY-N promotion mirrors reconnaissance's R-N flow: proposals confirmed
across 2+ sweeps → PR against this SKILL.md citing the HY-N IDs → mark
`promoted` with commit SHA + plugin version.

## Growth path (so future sessions don't re-litigate)

1. **v2 detectors:** D6 entry-level verify-open, D7 citation-format,
   D8 `docs/issues/` archive discipline — added when file-level sweeps are
   trusted and `miss` entries demand them.
2. **Batch approval** per detector via the trust table (mechanical rule
   above).
3. **Substrate promotion:** when D1/D2/D4 hold sustained zero-reject
   records, their detection graduates to a Rust
   `librarian(action="audit_trackers")` beside `audit_doc_refs`; the skill
   then consumes its output and keeps only triage in skill-land.
