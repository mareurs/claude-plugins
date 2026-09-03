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
| **Observed** | What *is* true | `git log -1` per file, actual directory, librarian catalog, `doc(action="list_stale")` |

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
- **On a catalog that was not built on this machine** — every detector reads the
  catalog, so a fresh checkout makes them report the machine rather than the corpus.
  Run the precondition check below first; it is a gate, not a detector.

## Precondition — is this catalog even this machine's?

**Run this check before Phase 1. If it fires, STOP: repair the catalog, then
sweep.** Not a detector — a gate. Every detector below reads the catalog, and on
a catalog that was never built here they report facts about the *machine* while
sounding like facts about the *corpus*.

The librarian catalog is machine-local and git-ignored. A checkout that has not
been indexed on this host arrives missing its semantic index, its `cites` edges,
and every artifact augmentation — while the markdown bodies look perfect, because
those are the half that travels.

**Detect it — three cheap reads:**

```
librarian(action="doctor")     → summary.by_check.augmentation_declared_but_absent
index(action="verify")         → git_sync.behind_commits, memories.missing_count
librarian(action="link_scan")  → counts.edges_missing   (report mode)
```

Any of `augmentation_declared_but_absent > 0`, `memories.missing_count > 0`, or an
`edges_missing` in the hundreds means the catalog is unrepaired. Repair first, then
start Phase 1.

### Why the sweep is invalid until then

Two reasons, both measured on codescout 2026-08-28 after pulling 437 commits onto a
laptop that had never built the project.

**1. D9's signal is inverted, not merely noisy.** `doc(action="list_stale")`
enumerates only artifacts that *have* an augmentation. Mid-repair, with 19 trackers
carrying none at all, it returned exactly **two** — the two that had just been
correctly restored, each with `last_refreshed_at: null`, `refresh_count: 0`,
`age_hours: null`. So D9 fires on the healthiest trackers in the corpus and is blind
to every broken one. Acting on it would propose refreshing the only two that need
nothing, while 19 genuinely-empty augmentations generate no finding at all.

`age_hours: null` is the tell: those artifacts are not stale-by-age, they have
*never been refreshed*. Treat a `list_stale` hit with a null age as a
never-augmented-here signal, not a staleness one.

**2. The ledger is in git; the catalog is not.** Phase 2 records `link_scan`'s
`counts.edges_missing` / `counts.dangling` into the sweep entry, and treats a jump
versus the previous sweep as worth an HY-N note. On the unrepaired laptop those read
**697 missing and 597 dangling** — numbers that describe a machine with no catalog,
not a corpus that decayed. Writing them into `tracker-hygiene-log.md` commits a
machine-local artifact into a repo-wide record, where it becomes a permanent false
baseline that every other checkout inherits and that the next sweep will "improve"
against.

D1 and D4 fail the same way for the same reason: an artifact with no catalog row is
indistinguishable from one whose row drifted.

### Repairing it

Ordered, because later steps read what earlier ones write:

1. `librarian(action="reindex")` — rows first; every `doc(find)` before this
   returns a confidently wrong empty set.
2. `index(action="verify")`, then repair memories server-side (for codescout:
   `codescout migrate-memories --in-place`). Check `skipped` in the result.
3. `index(action="build")` — background; poll `index(action="status")`.
4. `librarian(action="link_scan", write=true)`, then **run it once more**. A second
   scan reaching `edges_missing[0]` / `edges_stale[0]` is the proof it landed — the
   write reporting success is not.
5. Restore augmentations. No automated path exists: augmentation is the one artifact
   state with no on-disk form, so `expects_augmentation: true` records *that* one
   should exist and nothing records *what*.

**On step 5, two rules that decide whether the result is trustworthy:**

- **Mine the archive for quoted live calls before deriving anything from body prose.**
  Bug files quote the original calls verbatim, so they are the repo's accidental
  augmentation-shape store. On codescout this recovered an `entry_collection` name
  that prose would have gotten wrong, and a whole row field the body never mentions.
  Grep the artifact's id across `docs/issues/archive/` and read every hit showing an
  `doc(action="augment")` / `append_entry` / `update_entry` call or a `changed_fields`
  echo.
- **A field whose values are unrecoverable goes in the schema with no row carrying
  it,** stated in your report and in the augmentation `prompt`. Never fabricate to
  fill a column.

And do not read a prior restore as a checklist: codescout's archived restore recorded
10 rows for a tracker that had since grown to **30**. Re-derive the count from the
body every time.

**`index(verify)` and `index(status)` answer different questions.** `status` reports
freshness (`git_sync.behind_commits`); `verify` reports coverage. They genuinely
disagree — post-build the laptop showed `up_to_date, behind_commits: 0` *and*
`verdict: "incomplete"` with four eligible files unindexed. Check `verify` before
declaring the index repaired.

Verify the whole repair the same way: `doctor` shows
`augmentation_declared_but_absent: 0`, `link_scan` is at its fixpoint, and an
`entry_filter` query the project's own docs prescribe actually returns rows.

*(codescout's full write-up, with the measured numbers:
`codescout:docs/conventions/cross-machine-catalog-resume.md`.)*

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
- **Observed catalog:** `doc(action="find", kind="tracker", include_archived=true)` — note rows whose `status` or `rel_path` disagree with disk. This query is project-wide: it returns trackers **anywhere** in the project, including outside `docs/trackers/` (e.g. a subproject's `*/docs/*_TRACKER.md`). The file inventory above only sees `docs/trackers/` — so the two halves disagree on scope. Treat `docs/trackers/` as the sweep's authoritative scope; a catalog tracker living elsewhere is a *separate observation*, not a D1 index-drift finding. (If you reach for `librarian(action="doctor")` to find orphans, note it scans the **whole catalog across all projects** — filter its `missing_file` violations to this project's path.) `kind=tracker` can also return mis-classified `docs/issues/` bug files (a bug file carrying `kind: tracker`) — exclude `docs/issues/` from the cross-check; bug-file lifecycle is D8/v2.
- **Observed augmentation freshness:** `doc(action="list_stale", threshold_hours=168)`.
- **Observed citation-graph drift:** `librarian(action="link_scan")` (report mode) — record `counts.edges_missing` and `counts.dangling` in the sweep entry; a jump vs the previous sweep is an observation worth an HY-N note (materializing with `write=true` is a Phase-5 fix, gated like any other).
- **Declared:** parse the index file's rows (file links + claimed status); read each tracker's frontmatter `status:` via `read_file`.

### Phase 3 — Diff (the detectors)

Run each detector; emit findings as `(detector, evidence pair, proposed fix,
confidence)`. An evidence pair always names both sides: *"declared X;
observed Y"*.

| ID | Name | Fires when | Proposed fix | Confidence |
|---|---|---|---|---|
| **D1** | index-drift | Live file absent from the index, or index row points at a missing/moved file | add or repoint the index row — *which* cluster/section is a per-file placement judgment, so gate the placement, not just the add | high |
| **D2** | terminal-not-archived | Frontmatter `archived`/`superseded` but file in live dir; or file in archive dir with `status: active` | `doc(update, patch={status:...})` + `doc(move, new_rel_path=...)` per archive policy — **but a tracker superseded *by a successor* uses a `supersedes` edge, not a status patch (see note below)** | high |
| **D3** | stale-active | `status: active` and no git touch in N days | **a question** — archive, or confirm still-live? Never presume archive | low, by design |
| **D4** | frontmatter-catalog-mismatch | Catalog row disagrees with file frontmatter, or file has no catalog row / no `kind:` | reconcile via `doc(update)`; `librarian(action="reindex")` for orphans | high |
| **D5** | canonical-conflict | Two live trackers claim one topic (tag/topic overlap + index cluster), or a child restates its canonical's status | judgment call — merge, link, or bless the fork | low |
| **D9** | augmentation-stale | `doc(action="list_stale")` returns the artifact | refresh **only if mechanical**, else defer to owner (see the D9 rule below) — never fabricate | medium |
| **D10** | session-log-decay | File matches `*session-log*.md` in the live dir, frontmatter `status: active` or `draft`, AND no git touch in ≥21 days | propose **distill-then-archive** (procedure below) — never a bare archive; every sub-step is its own gate | low, by design |
| **D11** | promotion-pointer drift | An **active** entry claims a promoted status and the claim does not hold at the target: no `Promoted-to:` named, a named destination whose heading is absent, or a destination whose current text no longer carries the promoted claim | one of three verdicts — **repoint** / **absorbed** / **retire** — never a blanket relink, and never a `Status:` downgrade | high for "heading absent" (syntactic); **low by design** for the other two |

D6 (entry-level verify-open), D7 (citation format), D8 (`docs/issues/`
discipline) are **v2** — do not improvise them mid-sweep; a drift you notice
outside D1–D5/D9/D10/D11 is a `miss` HY-N entry, which is how v2 earns its way in.

**D9 defer-vs-refresh — default to defer.** Before synthesizing a D9 refresh, read
the augmentation's own prompt. Auto-refresh **only** when that prompt describes a
mechanical, gather-driven body ("summarize recent commits," a status rollup) — one
you can regenerate from the gathered context without domain judgment. If the prompt
is append-only or domain-expert (invariants, decisions, judgment-authored lessons —
e.g. an `SI-N` solving-invariants registry), or you are unsure, **defer to the
owner**: record the finding, do NOT synthesize entries, and do NOT reset the
staleness clock (it should re-surface next sweep). Fabricating into a domain
registry is the worst outcome; deferring a mechanical one only costs a re-run.

**`supersedes` is an edge, not a status (D2/D5).** When a tracker is terminal
because a *successor* replaced it, do NOT `doc(update,
patch={status:"superseded"})`. Create the edge — `doc(action="link",
src_id=<old>, dst_id=<successor>, rel="supersedes")` — which flips the old
tracker's status to `superseded` **and** emits the event; a bare status patch
leaves the graph and event log wrong. No successor → a plain `status: archived`
patch. Genuinely forked with no clear canonical → a D5 judgment, not an archive.
(`get_guide("tracker-conventions")` § Cross-linking.)

**D10 distill-then-archive — the session-log decay policy.** A session log's value
inverts once its work stream wraps: unpromoted content is index noise, and its
per-file F-1/W-1 numbering pollutes citation resolution. When D10 fires, walk this
sequence — each mutation is its own Phase-4 gate:

1. **Promote wins.** For every W-N with `Status: validated`, check its
   `Promote-when` criterion. Fired → promote (CLAUDE.md / skill / project memory,
   per the win's own routing) and set `promoted-to-permanent-docs`. Not fired →
   note it in the digest (step 4) so the criterion survives.
2. **Rehome open frictions.** For every F-N with `Status: open`, run a verify-open
   check against current code (distributed fixes leave entries zombie-open).
   Still real → promote to a bug file (`docs/issues/`) or move to the successor
   work stream's log; otherwise flip to `fixed-verified` / `wontfix-false-alarm`
   with one line of evidence.
3. **Confirm with the owner** that the work stream is actually wrapped (D3-style
   question — an idle-but-planned stream gets `defer`, which resurfaces next sweep).
4. **Compact.** Replace the body with an outcomes digest: the Index / Wins Index
   tables (statuses updated), one paragraph per promoted/rehomed entry naming its
   destination, and unfired Promote-when criteria. Full prose history stays in git.
5. **Archive through the catalog, in three steps — not two.** Per
   `archive-cadence-policy` § 3 (amended, ratified 2026-08-17):
   a. `doc(update, patch={status:"archived"})` — or a `supersedes` **edge**
      instead, when a successor replaced it (see the note above);
   b. `doc(move, new_rel_path="docs/trackers/archive/<name>-<YYYY-MM-DD>.md")`
      — **timestamped**, the date being the day the stream was declared wrapped in
      step 3. The timestamp is not decoration: `doc(move)` fails if the
      destination exists, so a stream that wraps, gets archived, is restarted at the
      live path and wraps again could not be archived at all. It is also the only
      surviving record of *when* it wrapped once the file leaves the live dir.
      (A ledger's **entry-level** archive companion is the opposite case — stable
      name, no timestamp, and check it exists before creating one, or the namespace
      forks into ambiguous tokens.)
   c. **Repoint citations of the old path AND the old 16-hex id, in the same commit**,
      then verify with a scoped `audit_doc_refs` (0 high findings as the gate).
      `link_scan(write=true)` does not do this — markdown citations are not catalog
      edges. HY-5 § 1 measured the cost of skipping it: 24 moves broke 8 path
      references across 7 live surfaces, none caught by `link_scan`, one failing CI on
      a release tip. Leave `docs/trackers/archive/**` and superseded session-log
      rounds alone — those are historical snapshots, and `archive_drop` exists so a
      retired document citing a moved path does not gate.

Evidence base: TMR-6 in codescout's `docs/trackers/tracker-management-redesign.md`
(2026-07-17 survey: session logs were the dominant zombie-active class in all three
surveyed repos; 6/13 codescout session logs untouched 4–5 weeks yet `active`).

**D11 promotion-pointer drift — check the target, never the entry.** A promotion claim is
the one tracker field whose truth lives entirely outside the tracker, so
`Status: promoted-to-permanent-docs` reads identical whether the text landed or not. Unlike
D10 this runs **every sweep**: D10 fires at ≥21 days idle, which is archive time, and a
lesson that failed to land is needed long before then.

**Scope to ACTIVE entries.** A stale pointer inside `docs/trackers/archive/**` is the
historical record, not drift — the same rule `audit_doc_refs`' `archive_drop` and
`get_guide("tracker-conventions")` already apply. Rewriting one falsifies the record to
satisfy a linter meant to ignore it.

**Three verdicts, because "fix the link" gets two of them wrong.**

- **repoint** — the rule survived a refactor at a new location. Rewrite the pointer.
- **absorbed** — the rule was generalized into a broader one. The pointer becomes a pointer
  to the general rule *plus* a note that this entry was one of its inputs. This is the
  verdict distillation actually produces, and the one a naive link-fixer silently converts
  into `repoint`, losing the fact that a specific lesson became a general rule.
- **retire** — the rule was dropped because it no longer applies. The promotion is void, and
  recording *that* is the fix: a fact about the lesson's lifetime, not an error to erase.

**Never resolve a D11 by editing the `Status:` down.** The finding is that a lesson is not
where it was said to be; the fix is to put it there. Downgrading makes the sweep green and
leaves the lesson absent.

**Three rules for reading the target, each earned from a measured miss:**

1. **Name every instance of the target, not the target's type.** An audit that wrote *"the
   user's global CLAUDE.md"* — singular — promoted into one file of three, on a machine
   running three Claude Code profiles. Enumerate the instances and compare them; files that
   should be identical have a checksum.
2. **For an installed artifact the target is the SERVING copy, not the repo source.**
   Measured 2026-08-20: three rules promoted into a plugin skill were byte-identical across
   all three profile caches *and* stale against source, because the commit never bumped the
   version the cache is keyed on. Comparing the copies to each other reads green there; only
   comparing each copy to the claim catches it. The session that made the edit is the least
   representative observer, being the only one reading the write-side copy.
3. **Prefer a back-citation to a verbatim quote.** A quote goes red when the promoted rule is
   legitimately reworded — a false positive produced by the promotion working as intended.
   The durable anchor is the promoted text citing its own entry id — *"(`codescout:R-1` + `codescout:R-7`.)"* — which survives every rewrite,
   so verification is a `grep` for the id.

Evidence base: **HY-11** in codescout's `docs/trackers/tracker-hygiene-log.md` — the spec,
the three verdicts, and why the graph route is unavailable (edges are artifact-grain,
promotions are entry-grain). Prerequisite shipped alongside: a `**Promoted-to:**` field in
the wins block of `docs/templates/session-log.md`, because a detector cannot check a pointer
that was never written. Also `docs/issues/2026-08-19-no-check-detects-a-fired-unharvested-promote-when.md`
(re-opened at n=2) and `prompt-surface-compaction-session-log:F-9`.

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

- Apply approved fixes **through the librarian** — `doc(update)`,
  `doc(move)` — never bare `git mv`, which orphans the catalog row
  (`id = sha256(abs_path)`).
- For a tracker superseded **by a successor**, archive via a `supersedes` edge —
  `doc(action="link", src_id=<old>, dst_id=<successor>, rel="supersedes")` —
  never a `status:"superseded"` patch: the edge flips status and emits the event
  (see the supersedes note in Phase 3).
- After applying **any** `doc(move)`, run `librarian(action="link_scan",
  write=true)` once — a move churns the `id` and the reindex cascade-drops the
  artifact's `cites` edges; `link_scan` heals them (idempotent, scanner-owned,
  never touches manual/`supersedes` rels). Log `edges_added`/`edges_pruned` in
  the sweep entry. Skip if `link_scan` is unavailable (see Degradation).
- Append the sweep entry (`## Sweep YYYY-MM-DD`) and bump `next-sweep-due`
  in one call. A sweep entry has no monotonic id — it's dated, not `HY-N` —
  so this goes through a plain body edit, not `append_entry`:

  ```python
  doc(action="update", id="<ledger artifact id>",
           patch={body_edits: [{heading: "## Template for new entries",
                                 action: "insert_before",
                                 content: "## Sweep YYYY-MM-DD\n..."}],
                  extra: {"next-sweep-due": "<today + sweep-interval-days>"}})
  ```

  For an `HY-N` meta-entry, let the server allocate the id instead — do not
  hand-grep the highest `HY-N` (this ledger has no index table; the headings
  ARE the index):

  ```python
  doc(action="append_entry", id="<ledger artifact id>", id_prefix="HY",
           anchor_heading="## Template for new entries",
           title="<one-line title>", body="**Verdict:** ...")
  ```

  `edit_file` is refused once the ledger declares `entry_prefix` to
  guard it (the template instructs this on first sweep) — it only works on
  an unguarded fresh copy.
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
- **`link_scan` unavailable** (older codescout build; the action isn't present)
  → skip the Phase-5 edge repair; note it in the sweep entry so the graph-repair
  gap is visible, not silent. (`link_scan` shipped on codescout `experiments`
  2026-07-05; not every build has it.)
- **Interrupted sweep** → safe by construction: nothing applies ungated,
  the ledger writes at the end, findings recompute next sweep.
- **Foreign-project sweep (target ≠ session home)** → the catalog detectors
  (D4, D9) run via `doc()` / `doc(action="list_stale")`, which query only the
  ACTIVE project and take **no** `workspace=` param. So you MUST
  `workspace(action="activate", path=<target>, read_only=false)` before Phase 2,
  and confirm the response shows `read_only: false` — a read-only activation
  blocks Phase 5 apply and the ledger bootstrap. Restore the home project before
  the turn ends (`get_guide("workspace-state")`). Pinning `workspace=` reaches only
  the file-based detectors (D1/D2/D3 via `run_command`/`read_file`), never the
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
