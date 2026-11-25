---
name: tracker-hygiene
description: Use when asked to run a tracker hygiene sweep, audit tracker staleness or drift, clean up docs/trackers, before backlog triage or any "what's open?" report, or when the SessionStart banner says a tracker hygiene sweep is overdue. Interactive — every finding is human-gated; approved fixes apply via the librarian; each sweep adds an entry to the project's hygiene box.
---

# /codescout-companion:tracker-hygiene

Tracker corpora drift even after formal consolidation: index maps miss new
files, terminal trackers linger in live directories, "active" frontmatter
outlives the work. Drift is a **disagreement between three states** the
project already holds — this skill diffs them and lets a human gate every
fix.

| State | What it is | Where it lives |
|---|---|---|
| **Convention** | The local dialect: status vocabularies, archive dir, index format | `CONVENTIONS.md`, `TAXONOMY.md`, archive policy docs, the box readmes (`codescout box <key>` prints a box's statuses, fields and rules) |
| **Declared** | What the project *says* is true | index/README cluster maps, frontmatter `status:` |
| **Observed** | What *is* true | `git log -1` per file, actual directory, librarian catalog, `doc(action="list_stale")` |

Some `doc` actions named in this skill (`list_stale`, `link`, `augment`) are missing from the MCP tool list. They are still callable in the same form as the listed ones, and `codescout call doc '<json>'` reaches them from a shell.

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
librarian(action="link_scan")  → counts.edges_missing   (report mode; absent on a derived-index checkout)
```

Any of `augmentation_declared_but_absent > 0`, `memories.missing_count > 0`, or an
`edges_missing` in the hundreds means the catalog is unrepaired. On a derived-index
checkout (its root `.gitignore` commits `/.codescout/derived.db*`) `link_scan` derives
its edges from the files and has no `edges_missing`, so read the first two only; read
doctor's `summary.not_run` as well: a check listed there did not run on the checkout it
names, so its `by_check` count covers the other checkouts only (`summary.served` gives
the store each checkout was read from). Repair first, then start Phase 1.

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

**2. The box is in git; the catalog is not.** Phase 2 records `link_scan`'s
`counts.edges_missing` / `counts.dangling` (on a derived-index checkout,
`counts.dangling` alone) into the sweep entry, and treats a jump
versus the previous sweep as worth a `meta` entry. On the unrepaired laptop those read
**697 missing and 597 dangling** — numbers that describe a machine with no catalog,
not a corpus that decayed. Writing them into the sweep entry commits a
machine-local artifact into a repo-wide record, where it becomes a permanent false
baseline that every other checkout inherits and that the next sweep will "improve"
against.

D1 and D4 fail the same way for the same reason: an artifact with no catalog row is
indistinguishable from one whose row drifted.

### Repairing it

Ordered, because later steps read what earlier ones write:

1. `librarian(action="reindex")` — rows first; every `doc(find)` before this
   returns a confidently wrong empty set. On a checkout whose rows are not kept it makes
   no rows (its answer lists the checkout under `old_phase_skipped`); `summary.not_run`
   says which checks did not run.
2. `index(action="verify")`, then repair memories server-side (for codescout:
   `codescout migrate-memories --in-place`). Check `skipped` in the result.
3. `index(action="build")` — background; poll `index(action="status")`.
4. `librarian(action="link_scan", write=true)`, then **run it once more**. A second
   scan reaching `edges_missing[0]` / `edges_stale[0]` is the proof it landed — the
   write reporting success is not. On a derived-index checkout skip this step:
   `write=true` is refused there, because the index derives every edge from the files.
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

If `codescout box` does not list `hygiene`, make the box now:

```bash
codescout box new worklog hygiene --title "Tracker hygiene sweeps" --exit-when "the repository stops running tracker hygiene"
```

Before you run the commit lines it prints, edit `docs/trackers/streams/hygiene/readme.md`: replace the
frontmatter keys `entry_kinds` and `statuses` and add `fields` as the block in
`references/tracker-hygiene-log-template.md` (§ Box readme) shows. Without it the box refuses a `sweep`
entry. Then run the commit lines, with the readme path in the `git add`.

### Phase 2 — Inventory

Build both states. All shell via `run_command`; never pipe unbounded output.

- **Observed dates:** `for f in $(git -C <root> ls-files 'docs/trackers/*.md'); do echo "$(git -C <root> log -1 --format=%ad --date=short -- "$f")  $f"; done`
- **Observed placement:** which files sit in the live dir vs the archive dir.
- **Observed catalog:** `doc(action="find", kind="tracker", include_archived=true)` — note rows whose `status` or `rel_path` disagree with disk. This query is project-wide: it returns trackers **anywhere** in the project, including outside `docs/trackers/` (e.g. a subproject's `*/docs/*_TRACKER.md`). The file inventory above only sees `docs/trackers/` — so the two halves disagree on scope. Treat `docs/trackers/` as the sweep's authoritative scope; a catalog tracker living elsewhere is a *separate observation*, not a D1 index-drift finding. (If you reach for `librarian(action="doctor")` to find orphans, note it scans the **whole catalog across all projects** — filter its `missing_file` violations to this project's path.) `kind=tracker` can also return mis-classified `docs/issues/` bug files (a bug file carrying `kind: tracker`) — exclude `docs/issues/` from the cross-check; bug-file lifecycle is D8/v2.
- **Observed augmentation freshness:** `doc(action="list_stale", threshold_hours=168)`.
- **Observed citation-graph drift:** `librarian(action="link_scan")` (report mode) — record `counts.edges_missing` and `counts.dangling` in the sweep entry; a jump vs the previous sweep is an observation worth a `meta` entry (materializing with `write=true` is a Phase-5 fix, gated like any other). On a derived-index checkout record `counts.dangling` alone: `counts.edges_missing` is absent and `write=true` is refused. Its population differs from the catalog scanner's: both count a 16-hex id that a non-empty old catalog does not hold (`counts.dangling_dead_ids` gives the derived share; on codescout 2026-11-21, 439 of 457), but the catalog scanner also counts a bare token whose prefix is known and that no document defines, and, with an empty catalog, every 16-hex id, while the derived report counts neither. So **do not compare the count across a sweep taken before the repository opted in and one taken after**; note in each sweep entry which side of the opt-in it was taken on.
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
| **D4** | frontmatter-catalog-mismatch | Catalog row disagrees with file frontmatter, or file has no catalog row / no `kind:` | reconcile via `doc(update)`; `librarian(action="reindex")` for orphans (a checkout whose rows are not kept makes none: read `summary.not_run`) | high |
| **D5** | canonical-conflict | Two live trackers claim one topic (tag/topic overlap + index cluster), or a child restates its canonical's status | judgment call — merge, link, or bless the fork | low |
| **D9** | augmentation-stale | `doc(action="list_stale")` returns the artifact | refresh **only if mechanical**, else defer to owner (see the D9 rule below) — never fabricate | medium |
| **D10** | session-log-decay | File matches `*session-log*.md` in the live dir, frontmatter `status: active` or `draft`, AND no git touch in ≥21 days | propose **distill-then-archive** (procedure below) — never a bare archive; every sub-step is its own gate | low, by design |
| **D11** | promotion-pointer drift | An **active** entry claims a promoted status and the claim does not hold at the target: no `Promoted-to:` named, a named destination whose heading is absent, or a destination whose current text no longer carries the promoted claim | one of three verdicts — **repoint** / **absorbed** / **retire** — never a blanket relink, and never a `Status:` downgrade | high for "heading absent" (syntactic); **low by design** for the other two |

D6 (entry-level verify-open), D7 (citation format), D8 (`docs/issues/`
discipline) are **v2** — do not improvise them mid-sweep; a drift you notice
outside D1–D5/D9/D10/D11 is a `miss` `meta` entry, which is how v2 earns its way in.

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
src_id=<successor>, dst_id=<old>, rel="supersedes")` — which flips the old
tracker's status to `superseded` **and** emits the event; a bare status patch
leaves the graph and event log wrong.

> **The direction is the trap, and this page had it backwards until 2026-09-14.**
> Read the edge as a sentence: **src supersedes dst**, so the DST is the one that
> gets marked `superseded`. `link.rs` takes `previous_status` from `dst` and its
> test `supersedes_transitions_dst_status` asserts `dst` becomes `superseded`.
> The earlier form here said `src_id=<old>, dst_id=<successor>` — which marks the
> SUCCESSOR superseded, the exact inverse of the intent, and does it silently:
> the call returns `ok` and reports the transition it caused, so the only way to
> notice is to read that field. Measured live that day on two codescout bug
> records, following this page verbatim. No successor → a plain `status: archived`
patch. Genuinely forked with no clear canonical → a D5 judgment, not an archive.

**D10 distill-then-archive — the session-log decay policy.** A session log's value
inverts once its work stream wraps: unpromoted content is index noise, and its
per-file F-1/W-1 numbering pollutes citation resolution. When D10 fires, walk this
sequence — each mutation is its own Phase-4 gate. The script
`d10_extract.py` sits next to this file (`<skill-dir>` is the "Base directory for this
skill" path printed when the skill loaded).

1. **Owner first.** Confirm with the owner that the work stream is actually wrapped
   (D3-style question — an idle-but-planned stream gets `defer`, which resurfaces next
   sweep). Steps 2 to 5 spend work that a `defer` throws away.
2. **Extract once.** Run `python3 <skill-dir>/d10_extract.py <log.md>`. It prints one row
   per real F-N / W-N entry: id, line, status token, status tail, and `Promote-when`
   (`-` when the entry has none), then the count and high-water mark of each kind.
   Template headings and fenced examples are skipped, so the count matches the entries.
   A row with status `(none)` is an entry with no `Status` line: report it, do not guess.
   Never split the log yourself on `## F-`: that split carries the next `W-` entry along.
   To fan out, give each agent one `--range W-1..W-82` and its own table, and require one
   evidence line per row (a path:line, or a command and its result).
3. **Give every entry one verdict from these lists.** Read the status by its first token:
   `validated`, `open`, `mitigated`, `fixed-verified`, `promoted-to-bug-tracker`,
   `promoted-to-permanent-docs` and `wontfix-false-alarm` are the log's own values, and
   a free-text tail after the token is a note.
   - **Win:** `already-promoted` (cite the path and heading you read), `fired-unpromoted`
     (promote it to `docs/conventions/`, a box readme, a memory or a skill, per the win's
     own routing, then set `promoted-to-permanent-docs`), `unfired` (quote the criterion
     into the digest), `no-criterion` (no `Promote-when`: it stays in the digest as it is),
     `obsolete` (its subject is gone). A recorded promotion whose text no longer holds is a
     D11 finding, not a verdict. A criterion that counts datapoints ("after N") is
     checked against the extraction table, never by recounting the corpus by hand.
   - **Friction:** run a verify-open check against current code for each `open` one
     (distributed fixes leave entries zombie-open), then `fixed` (flip to `fixed-verified`
     with one line of evidence), `still-real` (file it in the bugs box with
     `codescout box bugs add`, or move it to the successor stream's log), `lesson-only`
     (a rule with no code to check: digest it, or promote it as for a win), `obsolete`,
     or `false-alarm` (`wontfix-false-alarm`, one line of evidence).
4. **Compact.** Never reduce an F-N / W-N entry to a bare row: every entry keeps
   its `## <ID> — <title>` heading in the archived file, because `link_scan` binds
   PREFIX-N to that heading and to nothing else — git history is not consulted, so
   a citation whose heading is gone resolves Dangling. Prose beneath a heading may
   be shortened. Add the outcomes digest as an ADDITIONAL reading surface at the
   top: the Index / Wins Index tables (statuses updated), one paragraph per
   promoted/rehomed entry naming its destination, and unfired Promote-when
   criteria. Verify with `link_scan`: no new dangling citation for the stem's
   tokens. That covers bare tokens on a repository that has not opted in only. On a
   derived-index checkout the dangling check covers `[[<key>:TOKEN]]` and `[[<key>]]`
   only: a bare token there cites only an entry of its own document and is never
   dangling, and a prose `<stem>:TOKEN` is a `legacy_forms` item that never resolves, so
   grep for both.
5. **Archive through the catalog, in three steps — not two.** Use
   `archive-cadence-policy` § 3 (amended, ratified 2026-08-17), with the
   stem-citation exception below to its whole-file timestamp rule:
   a. `doc(update, patch={status:"archived"})` — or a `supersedes` **edge**
      instead, when a successor replaced it (see the note above);
   b. Choose the archive name, then `doc(move, new_rel_path=...)`:
      - **Stem-cited log:** code or any `<stem>:TOKEN` entry citation in the corpus
        (including archived documents) names the file stem. Keep the name:
        `docs/trackers/archive/<name>.md`. Before moving, record the day the stream
        was declared wrapped in step 1 with
        `doc(update, patch={extra:{archived_on:"<YYYY-MM-DD>"}})`.
        A timestamp rename breaks those citations; `link_scan` reports them as
        `CrossRepoToken`, not `dangling`, so a zero dangling count misses the break.
        On a derived-index checkout they are `legacy_forms` items with
        `form: "stem_token"`, renamed or not: look for the stem in their `raw`.
      - **Uncited log:** `docs/trackers/archive/<name>-<YYYY-MM-DD>.md`, the date
        being the day the stream was declared wrapped in step 1. The timestamp
        records when it wrapped and separates repeated wraps on different dates.
        `doc(move)` fails if the destination exists; check it before moving.
      - **Recheck after step 3 and immediately before the move.** Promotions can
        write new `<stem>:TOKEN` citations after the initial dossier. Choose from
        the current corpus, not the dossier's earlier naming decision.
      - **If the stable destination already exists, stop and ask the owner.** Do
        not invent a suffix: it changes the cited stem again. Do not overwrite the
        existing archive or merge distinct entry namespaces to avoid the collision.
      (A ledger's **entry-level** archive companion also keeps a stable name,
      without a timestamp. Check it exists before creating one, or the namespace
      forks into ambiguous tokens.)
   c. **Repoint citations of the old path AND the old 16-hex id — and, if the name
      changed, the old file stem (`<old-stem>:TOKEN`) — in the same commit**.
      Verify with `git grep -F '<old path>'` (no hit outside `docs/trackers/archive/**`)
      beside the control `git grep -F '<new path>'` (must hit): `audit_doc_refs` reports a
      moved path cited under `docs/trackers/**` at `Med`, so `--fail-on high` passes with
      the citation still stale. Also run a
      `link_scan` report with no `CrossRepoToken` whose qualifier is the old stem (on a
      derived-index checkout, no `legacy_forms` item with `form: "stem_token"` whose
      `raw` starts with the old stem).
      Read all relevant findings if the report is truncated; a cut list cannot
      establish absence.
      `link_scan(write=true)` does not do this — markdown citations are not catalog
      edges, and a derived-index checkout refuses it. A sweep measured the cost of
      skipping it: 24 moves broke 8 path
      references across 7 live surfaces, none caught by `link_scan`, one failing CI on
      a release tip. Leave `docs/trackers/archive/**` and superseded session-log
      rounds alone — those are historical snapshots, and `archive_drop` exists so a
      retired document citing a moved path does not gate.
      When a move removes a surface, repair the **pointers** (prose that tells a reader to
      consult it) and leave the **records** (prose that narrates what happened): deleting a
      record falsifies the evidence that the surface existed. Then stat every path your own
      edit names, because a repair can add a dangling one.

Evidence base: TMR-6 in codescout's `docs/trackers/tracker-management-redesign.md`
(2026-07-17 survey: session logs were the dominant zombie-active class in all three
surveyed repos; 6/13 codescout session logs untouched 4–5 weeks yet `active`).

**D11 promotion-pointer drift — check the target, never the entry.** A promotion claim is
the one tracker field whose truth lives entirely outside the tracker, so
`Status: promoted-to-permanent-docs` reads identical whether the text landed or not. Unlike
D10 this runs **every sweep**: D10 fires at ≥21 days idle, which is archive time, and a
lesson that failed to land is needed long before then.

**Scope to ACTIVE entries.** A stale pointer inside `docs/trackers/archive/**` is the
historical record, not drift — the same rule `audit_doc_refs`' `archive_drop` already
applies. Rewriting one falsifies the record to
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

Read the **detector trust table** of the newest `sweep` entry first: run
`codescout box hygiene list --all` (a `sweep` is filed `done`, so the plain list hides it), then
`codescout box hygiene show <newest key> --full`. When the box has no `sweep` entry, read the table from
`## Detector trust state` of `docs/trackers/tracker-hygiene-log.md` if that file exists, else start from the
all-`individual` table of `references/tracker-hygiene-log-template.md`. For detectors in
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
  `doc(action="link", src_id=<successor>, dst_id=<old>, rel="supersedes")` —
  never a `status:"superseded"` patch: the edge flips status and emits the event
  (see the supersedes note in Phase 3, including the direction warning — **src
  supersedes dst**, so the DST is the one marked `superseded`).
- After applying **any** `doc(move)`, run `librarian(action="link_scan",
  write=true)` once — a move churns the `id` and the reindex cascade-drops the
  artifact's `cites` edges; `link_scan` heals them (idempotent, scanner-owned,
  never touches manual/`supersedes` rels). Log `edges_added`/`edges_pruned` in
  the sweep entry. Skip if `link_scan` is unavailable (see Degradation). On a
  derived-index checkout skip it too: `write=true` is refused there, and the index
  reads every edge from the files, so a move leaves no edge to heal.
- File the sweep entry and set the due date in one call. The body is the sweep
  entry of `references/tracker-hygiene-log-template.md`, ending with the
  detector trust table after this sweep (zero-reject streaks, demotions). The
  field `next_sweep_due` is today plus 30 days. It must read `YYYY-MM-DD`: the box accepts any
  text there, and the hook ignores a value that is not a date:

  ```bash
  codescout box hygiene add --kind sweep --status done --title "Sweep YYYY-MM-DD" --text body - '{"fields":{"next_sweep_due":"YYYY-MM-DD"}}' <<'EOF'
  <the sweep entry>
  EOF
  ```

  The call commits the entry and prints its key.
- File a `meta` entry for anything about the skill itself: a `miss` (drift found
  outside the detectors), a `false-positive-pattern` (recurring reject reason), a
  `proposal`. The body starts with the line `**Verdict:** <verdict>`:

  ```bash
  codescout box hygiene add --kind meta --title "<one-line title>" --text body - <<'EOF'
  **Verdict:** <verdict>
  <the observation>
  EOF
  ```
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
  the box entry is the last write, findings recompute next sweep.
- **Foreign-project sweep (target ≠ session home)** → the catalog detectors
  (D4, D9) run via `doc()` / `doc(action="list_stale")`, which query only the
  ACTIVE project and take **no** `workspace=` param. So you MUST
  `workspace(action="activate", path=<target>, read_only=false)` before Phase 2,
  and confirm the response shows `read_only: false` — a read-only activation
  blocks Phase 5 apply and the box bootstrap. Restore the home project before
  the turn ends. Pinning `workspace=` reaches only
  the file-based detectors (D1/D2/D3 via `run_command`/`read_file`), never the
  catalog — so a pinned-not-activated sweep silently runs at most half the detectors.

## Stop conditions

- The user rejects three findings in a row from the same detector — stop
  presenting that detector's findings this sweep, log a
  `false-positive-pattern` `meta` entry, move on.
- More than ~25 findings total — present counts per detector first and ask
  which detectors to triage this session; the rest defer.

## The box (per project)

The box `hygiene` (`docs/trackers/streams/hygiene/`), made from this skill's
`references/tracker-hygiene-log-template.md`. Holds `sweep` entries and `meta`
entries; the newest `sweep` entry carries the detector trust table. The
companion's SessionStart hook reads the greatest `next_sweep_due` in the
frontmatter of its entries (and the flat log's `next-sweep-due:` when no entry
has one) and nudges when it is due — setting that field is part of every
sweep's Phase 5.

Promotion of a `meta` entry mirrors reconnaissance's R-N flow: proposals confirmed
across 2+ sweeps → PR against this SKILL.md citing the entry keys → mark
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
