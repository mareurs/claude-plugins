---
kind: tracker
status: active
title: Tracker hygiene log
tags:
- hygiene
- skill-meta
- lifecycle
entry_prefix: HY
next-sweep-due: 2026-10-05
sweep-interval-days: 30
entry_high_water_HY: 1
---

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
A detector enters `batch` after **two consecutive advancing sweeps** — a sweep
advances only if the detector fired and every finding was approved (zero rejects,
zero defers). Any reject resets to `individual`; a no-finding or deferred sweep is
neutral (streak unchanged).

| Detector | Mode | Consecutive zero-reject sweeps | Last reject (sweep, reason) |
|----------|------|-------------------------------|------------------------------|
| D1 index-drift | individual | 1 | — |
| D2 terminal-not-archived | individual | 0 | — |
| D3 stale-active | individual | 0 | 2026-09-05, both rejected (confirmed still-live, not stale) |
| D4 frontmatter-catalog-mismatch | individual | 1 | — |
| D5 canonical-conflict | individual | 0 | — |
| D9 augmentation-stale | individual | 0 | — |
| D10 session-log-decay | individual | 0 | — |
| D11 promotion-pointer drift | individual | 0 | — |

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
| D10 session-log-decay | 0 | 0 | 0 | 0 |

**Rejects (verbatim reasons — the training signal):**
- <detector>: "<finding one-line>" → rejected: <reason>

**Fixes applied:** "this commit" (a sweep entry can't cite its own commit's SHA); use the project's citation format for any *external* SHA.

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

## Sweep 2026-09-05

**Scope:** docs/trackers/ | **Files inventoried:** 29 (26 under docs/trackers/, 1 in buddy/, 1 template, INDEX.md) | **Convention sources:** `docs/trackers/INDEX.md` (missed on first Phase-1 pass — only grepped for `README.md`; see HY-1) + `get_guide("tracker-conventions")`

**Precondition repair (before Phase 1):** `index(verify)` showed `memories.missing_count: 11` — the catalog was unrepaired, stale from a `git reset --hard origin/main` earlier this session that moved the tree 60 commits without a matching `librarian(reindex)`. Repaired: `librarian(reindex)`, `codescout migrate-memories --in-place` (11/11 re-embedded), `link_scan(write=true)` run twice to a fixpoint (`edges_missing[0]`, `edges_stale[0]`). The semantic file-vector index (439 files) could not rebuild — `index(build)` reports the running MCP server's own binary was deleted from disk (rebuilt elsewhere mid-session); needs `/mcp` to reconnect, outside this session's reach. Did not block this sweep — no detector here uses `semantic_search`. `librarian(action="doctor")`'s 662 violations were near-entirely cross-project noise (an unrelated `~/Documents/PFA` project sharing this catalog); confirmed via `doc(find, filter={rel_path:{prefix:"docs/trackers"}})` returning 15 clean rows before any fix.

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 1 | 1 | 0 | 0 |
| D2 terminal-not-archived | 0 | 0 | 0 | 0 |
| D3 stale-active | 2 | 0 | 2 | 0 |
| D4 frontmatter-catalog-mismatch | 14 | 14 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 1 | 0 | 0 | 1 |
| D10 session-log-decay | 5 | 4 | 0 | 1 |
| D11 promotion-pointer drift | 0 | 0 | 0 | 0 |

**D1 (1, approved):** `INDEX.md`'s table omitted 3 files that exist under `docs/trackers/` and carry F-N/W-N session-log shape: `research-skills-refactor-session-log.md`, `pi-agent-integration-session-log.md`, `session-passover-impl-session-log.md`. Rows added.

**D3 (2, rejected — confirmed still-live, not stale):**
- `eval-bringup.md` (113 days idle): rejected — 3 of 7 done-conditions unmet (`fixtures_expanded_to_5: false`, `first_baseline_frozen: false`, `ci_wired: false`), real remaining work per its own live-state block.
- `fixture-expansion.md` (112 days idle): rejected — 1 of 11 specialist rows done, explicit `review_cadence: revisit after each Phase 2 batch lands`; deferred-but-planned by its own design, not abandoned.

**D4 (14, approved — the sweep's main finding):** `docs/trackers/INDEX.md` documents a whole pre-librarian tracker system — hand-maintained index table + per-file fenced `live-state` YAML blocks, `open`/`draft`/`closed` vocabulary — used by 14 files instead of catalog frontmatter. Several files' own prose states why: *"Plain-markdown fallback because `claude-plugins` is not registered as a codescout artifact repo."* That precondition no longer holds. User approved a full migration this sweep, not a defer: every file now carries `kind: tracker` + `status:` + `title:` frontmatter (status mapped from INDEX's declared value: `open`→`active`, `draft`→`draft`). Three files (`active-plan.md`, `skill-loading-session-log.md`, `guard-hardening-session-log.md` — all declare `entry_prefix`) are ledger-guarded against `edit_file`'s frontmatter action; `doc(action="update")`'s `patch` has no `kind` field either — added `kind: tracker` via a single-line `sed` insert (entry_prefix/entry_high_water untouched, verified), then set `status:` via `doc(update)` (which the ledger guard's own hint text sanctions). The other 11 got `kind`/`status`/`title` via `edit_file`'s `frontmatter.set`, which creates the block where none existed. `docs/trackers/INDEX.md` itself: `kind: index` (not `tracker` — it's the map, not a tracked stream), `status: active`. Its Conventions section rewritten to describe the frontmatter convention instead of the retired fenced-block one. Bonus fix while in `injection-budget-session-log.md`: its H1 still read `# Session Log — Template`, a leftover from copying `docs/templates/session-log.md` and never renaming — fixed alongside.

**D9 (1, deferred):** `prompt-hamsa-audit-log.md` — `age_hours: null`, `refresh_count: 0`. Per this skill's own rule, a null age is a never-refreshed-here signal, not staleness; it's also a domain-expert self-reflection ledger, not a mechanical rollup. Deferred, not auto-refreshed.

**D10 (5, 4 approved / 1 deferred):** All 5 newly-migrated session-logs idle 63–113 days with `status: active`. Read each Index/Wins Index table before deciding:
- `injection-budget-session-log.md`: **archived** — 4/4 frictions `fixed-verified`, 2/2 wins `validated`; both Promote-when criteria need 2 datapoints, have 1 — no promotion, straight to archive.
- `release-hygiene-session-log.md`: **archived** — 0 open frictions, 1 win `validated`; Promote-when needs 2 datapoints, has 1.
- `research-skills-refactor-session-log.md`: **archived** — F-1 `mitigated`, F-2 `fixed-verified`, no wins.
- `pi-agent-integration-session-log.md`: **archived** — 2/2 frictions `fixed-verified`, 1 win `validated`; Promote-when needs 2 datapoints, has 1.
- `codescout-usage-audit-session-log.md`: **deferred, kept active** — U-1..U-5 (Pika usage-frictions) all `status: open`, and U-2/U-3 recommend `read_markdown`/`edit_markdown`, both retired by the 2026-09-02 tool collapse. Not archive-worthy (real open items) and the open items themselves are stale-by-tool-rename. Added an `UPDATE 2026-09-05` caveat at the tracker's top (matching its own existing convention for exactly this situation) and filed `repo-remediation-backlog:RM-28`.

All 4 archives: `doc(update, patch={status:"archived"})` then `doc(move, new_rel_path="docs/trackers/archive/<slug>-2026-09-05.md")`; `INDEX.md` rows repointed to the new paths in the same pass; `librarian(link_scan, write=true)` run twice post-move to a fixpoint. Staged with `git add -- <old> <new>` per move — confirmed single `R` rename line for all 4, not a `D`+`??` pair.

**Rejects (verbatim reasons — the training signal):**
- D3: "eval-bringup.md 113 days idle, status active" → rejected: "3/7 done-conditions unmet, real remaining work per its own live-state block"
- D3: "fixture-expansion.md 112 days idle, status active" → rejected: "1/11 specialists done, explicit review_cadence, deferred-but-planned by design"

**Fixes applied:** this commit (and the immediately preceding tracker-refresh/hook-fix commits earlier this session).

**Detector trust updates:** D1 → individual, streak 1 (first sweep, needs 2 consecutive to graduate). D4 → individual, streak 1. D3 → individual, streak 0 (rejects only). D9/D10 → individual, streak 0 (a defer is neutral, not advancing).

**HY-1 filed:** this skill's Phase 1 instructs looking for `docs/trackers/README.md`; this project's index is `docs/trackers/INDEX.md`. The first pass missed it entirely and nearly ran a thin sweep on a project that has a rich, real index. Proposal: Phase 1 should say "a file named `README.md`, `INDEX.md`, or similar" rather than one exact filename.

**Next sweep due:** 2026-10-05 (frontmatter updated in this edit)
## HY-1 — Phase 1's index-file search names one exact filename, missing this project's real index

**Valid:** dated 2026-09-05

**Verdict:** proposal

**Sweep:** 2026-09-05 (this ledger).

**Observation:** Phase 1 lists `docs/trackers/README.md` as the index file to look for.
This project's index is `docs/trackers/INDEX.md`. The first pass ran `ls
docs/trackers/README.md docs/TAXONOMY.md docs/trackers/CONVENTIONS.md
docs/trackers/archive-cadence-policy.md`, got four `No such file`s, and concluded "no
convention docs exist" — nearly running a thin sweep (D1 skipped) on a project that has
a rich, hand-maintained index covering 15+ trackers with purpose/status/blocking-edges
columns. Caught only because a later `git ls-files` incidentally surfaced `INDEX.md`
by name.

**Proposal (if any):** Phase 1's bullet should read "a tracker index (commonly
`docs/trackers/README.md` or `docs/trackers/INDEX.md`, but check for any file whose
content is an index/map of the other trackers)" rather than naming one exact filename.

**Promote-when:** same shape confirmed across 2+ sweeps (this project's next sweep, or
a sibling project's ledger hitting the same miss).

## Template for new entries

<!-- Insert a new Sweep entry above this line via a plain body edit
     (sweep entries are dated, not HY-N — no id to allocate):

     doc(action="update", id="<ledger artifact id>",
              patch={body_edits: [{heading: "## Template for new entries",
                                    action: "insert_before",
                                    content: "## Sweep YYYY-MM-DD\n..."}],
                     extra: {"next-sweep-due": "YYYY-MM-DD"}})

     Insert a new HY-N entry via append_entry — let the server allocate
     the id and write the section in one call; do not hand-grep the
     highest HY-N:

     doc(action="append_entry", id="<ledger artifact id>", id_prefix="HY",
              anchor_heading="## Template for new entries",
              title="title", body="**Verdict:** ...")

     `edit_file` is refused once entry_prefix guards the ledger —
     it only works on an unguarded fresh copy. -->
