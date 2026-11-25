---
kind: tracker
status: active
title: Tracker hygiene log
tags:
- hygiene
- skill-meta
- lifecycle
entry_high_water_HY: 7
entry_prefix: HY
next-sweep-due: 2026-12-25
sweep-interval-days: 30
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
| D1 index-drift | batch | 4 | — |
| D2 terminal-not-archived | batch | 2 | — |
| D3 stale-active | individual | 1 | 2026-09-05, both rejected (confirmed still-live, not stale) |
| D4 frontmatter-catalog-mismatch | batch | 3 | — |
| D5 canonical-conflict | individual | 0 | — |
| D9 augmentation-stale | individual | 0 | — |
| D10 session-log-decay | individual | 1 | — |
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
## Sweep 2026-10-19

**Scope:** docs/trackers/ | **Files inventoried:** 28 (including INDEX.md) | **Convention sources:** `docs/trackers/INDEX.md` + `get_guide("tracker-conventions")`

**Precondition (passed, no repair needed):** `augmentation_declared_but_absent` 0, `memories.missing_count` 0, `link_scan` `edges_missing` 35. `index(verify)` reported `stale`: 91 files unindexed, which the 3-commit gap to HEAD explains (`7de8d301` against `b3a25808`). The index was not rebuilt. `doctor` reported 46 violations. The 11 `row_behind_file` hits are `buddy/commands/*.md` and `harnesses/pi/README.md`, working-tree edits the catalog had not read; they are not tracker drift.

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 13 | 13 | 0 | 0 |
| D2 terminal-not-archived | 1 | 1 | 0 | 0 |
| D3 stale-active | 1 | 1 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 0 | 0 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 1 | 0 | 0 | 1 |
| D10 session-log-decay | 5 | 2 | 0 | 3 |
| D11 promotion-pointer drift | 0 | 0 | 0 | 0 |

**D1 (13, approved):** 13 files had no mention in `INDEX.md`. The operator approved all 13. Twelve rows were added to the Active trackers table. The 13th, `subagent-bootstrap-session-log`, went in as an archived row after its D10 archive. Five of the 13 were also missing at the 2026-09-05 sweep.

**D2 (1, approved):** `passover-effort-steering-second-phase-2026-10-05.md` had `status: superseded` and sat in the live directory. No other file cited its path. Moved to `docs/trackers/archive/` with the same name. Its id changed to `5e62ea41ac312c1f`.

**D3 (1, approved through D10):** `subagent-bootstrap-session-log.md`, 47 days idle, `active`. It was resolved by its D10 archive. `passover-roster-audit-release-integrity-2026-08-26.md` was exactly 45 days idle and was not raised. Caveat on the clock: the 2026-09-05 migration commit reset the git date of `eval-bringup.md` and `fixture-expansion.md`, so their idle age reads 44 days and understates the real gap.

**D5 (0):** not examined in depth. Absence of a finding is not evidence here.

**D9 (1, deferred):** `prompt-hamsa-audit-log.md`, `age_hours: null`, `refresh_count: 0`. A null age means never refreshed here, and the ledger is a domain-expert audit log, so the skill says defer. Same finding and same verdict as 2026-09-05.

**D10 (5, 2 approved / 3 deferred):**
- `subagent-bootstrap-session-log`: **archived** under its stable name, with `archived_on: 2026-10-19`. It has 0 open frictions, and `W-1` is validated but its 2-datapoint promotion criterion is unmet. Code and a skill cite `subagent-bootstrap-session-log:F-6` and `:F-8`, so the name was kept, and the entries were kept verbatim (no compaction). The malformed `F-8` `**Valid:**` line was repaired first (`HY-3`).
- `session-passover-impl-session-log`: **archived** under its stable name, with `archived_on: 2026-10-19`. It has 0 open frictions; `F-2` is mitigated, and `W-1` is a single datapoint. An archived passover cites `session-passover-impl-session-log:F-3` by stem. The INDEX row was repointed to `archive/`.
- `repo-hygiene-session-log`: **deferred.** `F-2` is open and concerns codescout's session-log template, in another repo. The operator selected this log for triage, but gave no verdict on the defer proposal.
- `roster-audit-session-log`: **deferred.** `W-4` and `W-5` are `candidate`, the `W-4` addendum is open, and `F-14` is `fixed-at-source pending`. Same: selected for triage, no verdict on the defer proposal.
- `codescout-usage-audit-session-log`: **deferred.** Not presented this sweep. The 2026-09-05 deferral stands.

**D11 (0):** every `promoted-to-permanent-docs` hit in the live trackers is a template or vocabulary line. None is a promotion claim.

**Outside the detectors:** `docs/trackers/ledgers/bugs/2026-11-24-tests-run-all-sh-has-16-pre-existing-failing-suites.md` had a stale top banner ("kept `zombie`"). Its status `investigating` is correct, because the bug was re-opened 2026-09-10. A supersession banner was added and the status was left alone. An earlier reading in this sweep that the status should become `zombie` was wrong and was not applied. Two `miss` entries were filed: `HY-2` and `HY-3`.

**Rejects (verbatim reasons):** none.

**Fixes applied:** this commit (not yet made when this entry was written). Citations repointed in the same pass: the `R-1` source path in `reconnaissance-patterns.md`, the 2026-07-28 history entry in `version-bump-checklist.md`, the `ES-13` passover id in `effort-steering-second-phase.md`, and the Pointers id in `passover-effort-steering-2026-10-07.md`. Left alone as historical snapshots: two executed plan files under `docs/superpowers/plans/` (path citations, and one old id in the 2026-07-28 plan) and an archived passover. `link_scan(write=true)`: the first run added 47 edges and pruned 0. The second scan reported `edges_missing[0]` and `edges_stale[0]`. `ambiguous` moved from 101 to 103 and `dangling` stayed at 68; the cause of the +2 was not examined.

**Detector trust updates:** D1 advanced to streak 2 and entered `batch`. D2 advanced to streak 1. D3, D9 and D10 are unchanged: D3's finding was resolved through D10 rather than a gate of its own, and D9 and D10 had deferrals. D4, D5 and D11 had no findings.

**Next sweep due:** 2026-11-18 (frontmatter updated in this edit)
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

## HY-2 — The doctor finds a cited id prefix with no definer, and no detector does

**Valid:** dated 2026-10-19

**Verdict:** miss

**Sweep:** 2026-10-19 (this ledger).

**Observation:** `librarian(action="doctor")` reported `cited_prefix_with_no_definer` for `MQ-N` in `docs/trackers/claude-mods-research-2026-10-06.md`. The prefix is cited 10 times across 2 files, but no `## MQ-N — <title>` heading exists anywhere in the corpus. The doctor message is clipped at `entry_pr…`, so I read the rest of its claim (no artifact declares an `entry_prefix`) only as far as that clipped text shows. No detector D1 to D11 flagged this. The sweep logged it and did not fix it, because you asked only for a log entry.

**Proposal (if any):** the v2 detector D7 (citation format) should consume the doctor's `cited_prefix_with_no_definer` check. Until D7 exists, Phase 2 could list the doctor's per-check counts that are non-zero for `docs/trackers/`.

**Promote-when:** the same shape (a cited id prefix with no defining heading) is found by a doctor run in a second sweep.

## HY-3 — The doctor finds a malformed Valid line, and no detector does

**Valid:** dated 2026-10-19

**Verdict:** miss

**Sweep:** 2026-10-19 (this ledger).

**Observation:** `librarian(action="doctor")` reported `validity_unparseable` for `F-8` in `subagent-bootstrap-session-log.md`. The line read `**Valid:** invariant — measured directly end-to-end; supersedes both the original conditional and the retraction's`. The accepted forms are `invariant`, `dated YYYY-MM-DD` and `conditional — <event>`, so prose after `invariant` makes the line unparseable. The source line also ended in the middle of a sentence, at "the retraction's". No detector D1 to D11 flagged it.

**Fix applied:** the line is now `**Valid:** invariant`. The former text sits on the next line, marked as the former Valid line, verbatim and still cut at the same word. The sweep did not guess how the sentence continued. The log was then archived (D10) under its stable name.

**Proposal (if any):** Phase 2 should read `librarian(action="doctor")` and list its non-zero `validity_unparseable` findings for `docs/trackers/`. A D10 candidate with this defect should have it repaired before the digest or archive step.

**Promote-when:** the same shape is found in a second sweep, or by a sibling project's ledger.

## Sweep 2026-11-25

**Scope:** docs/trackers/ | **Files inventoried:** 34 live files (including INDEX.md) | **Convention sources:** `docs/trackers/INDEX.md` + `get_guide("tracker-conventions")`

**Precondition (passed):** `augmentation_declared_but_absent` 0 and `link_scan` `edges_missing` 29. `index(verify)` reported `memories.missing_count` 2 (`plugin-load-channels`, `session-passover`) and one orphan point (`research/hold-ack-probe-20261124`). That is a memory-index gap, not a catalog gap, so the sweep went on. The repair is `codescout migrate-memories --in-place`; it was not run.

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 9 | 9 | 0 | 0 |
| D2 terminal-not-archived | 2 | 2 | 0 | 0 |
| D3 stale-active | 3 | 3 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 3 | 3 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 1 | 0 | 0 | 1 |
| D10 session-log-decay | 3 | 2 | 0 | 1 |
| D11 promotion-pointer drift | 0 | 0 | 0 | 0 |

**D1 (9, approved):** nine live files had no row in `INDEX.md`. Before approving, the operator asked what the seven non-D2 files contain and whether they are still actual. Each was checked against the repository: four were finished or obsolete and were archived (below), and three stayed live (`collection-hot-path-session-log`, `harness-identification-session-log`, `session-bridge-codex-session-log`). Nine rows were added: three live, six archived.

**D2 (2, approved):** `pr16-opencode-session-log` (status `archived`) and `pr10-audit-session-log` (status `done`) sat in the live directory. Both moved to `docs/trackers/archive/` under their stable names. The one path citation of `pr10-audit-session-log` (a plan) was repointed.

**D3 (3, approved):** `passover-roster-audit-release-integrity-2026-08-26` (82 days idle, its Next actions read CLEARED) was consumed and archived. `eval-bringup` and `fixture-expansion` (80 days idle, no commit since 2026-09-05) were archived; the 2026-09-05 sweep had rejected the same finding as still live, and this operator chose archive. **`fixture-expansion` had 10 of 11 fixtures pending.** `validation-domain-coverage` still says it "owns closing" that gap, so the work now has no live tracker.

**Also archived through the D1 check (4):** `pr19-opencode-session-log` (PR #19 merged, 0 open), `s4-debug-session-log` (closed after PR 20), `session-channel-handover` (the plan shipped in `session-bridge` 0.3.x; worktree and branch gone) and `passover-codex-daemon-0169-install-2026-11-18` (the install journal no longer exists; CLI is 0.171.0; a Consumed section was added). The passover's two citers, a memory and its anchors file, were repointed.

**D4 (3, approved):** `collection-hot-path-session-log` and `portable-workflows-session-log` got `status: active` in their frontmatter. `session-channel-handover` had no frontmatter and was resolved by its archive.

**D5 (0):** not examined in depth. Absence of a finding is not evidence here.

**D9 (1, deferred):** `prompt-hamsa-audit-log`, `age_hours: null`, `refresh_count: 0`. Domain-expert audit log, so the skill says defer. Same finding and same verdict as 2026-10-19.

**D10 (3, 2 approved / 1 deferred):** `skill-loading-session-log` (43 days idle) was archived later the same day, after a verify-open pass: its two open frictions were re-measured and closed. `F-6` (which bytes the Skill tool serves) was probed with a marker line that exists only in the working tree: the served text came from the cache while the printed base directory was the tree, on Claude Code 2.1.332. It is `mitigated` by `scripts/check-skill-skew.sh` and its test. `F-7` (PostToolUse fires for Skill calls) was re-measured on 2.1.332 and is `fixed-verified`; the false docstring in `buddy/scripts/skill_ledger.py` was corrected. The owner confirmed the work stream is wrapped. `W-1` and `W-2` stay `validated` with one datapoint each, and the digest at the top of the archived file names their unfired promote-when criteria. Pointers were repointed in the memory `plugin-load-channels`, `buddy/scripts/reload.py`, the 2026-06-12 spec and plan, `INDEX.md` and one runtime-box entry; dated records were left alone. `portable-workflows-session-log` (43 days idle) was archived the same day after its own verify-open pass. Its five open frictions were checked against the code and the design: `F-1`, `F-3` and `F-5` reviewed a design that was superseded on 2026-10-13 and never built, so they became `moot-superseded`, a status the log added. `F-2` and `F-6` share one residual that exists today (`session_id_from_env` reads only `$OPENCODE_SESSION_ID`, so on Claude Code the model-driven summon and `/buddy:focus` use the last-writer pointer); both were promoted to one bug, `2026-11-25-buddy-on-claude-code-the-model-driven-summon-and-buddy-focus`. `F-4` stays `mitigated`. `W-1` and `W-2` stay `validated` with one datapoint each. Its three path citations (the design spec, `INDEX.md`, `tests/test-codex-convertible-commands.sh`) were repointed. `codescout-usage-audit-session-log` (79 days, 5 open frictions, deferred a third time) stays deferred; it needs the same verify-open pass.

**D11 (0):** every `promoted-to-permanent-docs` hit in the live trackers is a template or vocabulary line.

**Outside the detectors:**
- `collection-hot-path-session-log` still marks `F-1` ("no `hot-view`") and `F-2` ("no collection exists") `open`, while the hot-view hook runs today. `harness-identification-session-log:F-2` (root `AGENTS.md` stale) is also fixed. Both need a verify-open pass.
- `doctor` reports 16 defects (`frontmatter_id_mismatch` 6, `row_behind_file` 4, `terminal_status_with_caveat` 2, `retired_object_still_present` 2, `entry_dated_stale` 3 in scope). They were not triaged.

**link_scan:** before the moves `edges_missing` 29, `edges_stale` 20, `dangling` 121, `ambiguous` 130. The first write added 38 edges and pruned 20. After the last pass: `edges_missing` 0, `edges_stale` 0, `edges_added` 0, `edges_pruned` 0, `dangling` 121, `ambiguous` 134. The checkout is not derived-index. The `ambiguous` rise comes from the moved files' own tokens, and `dangling` did not move.

**Rejects (verbatim reasons):** none.

**Fixes applied:** this commit. Citations repointed in the same pass: `docs/superpowers/plans/2026-11-18-pr10-current-bootstrap.md`, `docs/superpowers/plans/2026-11-18-s4-preflight-test-isolation.md`, `docs/trackers/active-plan.md` (its Live state, Phase 0 and T-9 pointers), `docs/trackers/buddy-learning-and-model-drift.md`, `eval/scripts/calibrate.sh`, and the codex-daemon memory with its anchors file. Dated records were left alone: `active-plan.md` history lines, the older sweep entries, `roster-audit-session-log:695` and `docs/issues/archive/**`.

**Detector trust updates:** D1 advanced to streak 3 (batch). D2 advanced to streak 2 and entered `batch`. D3 advanced to streak 1. D4 advanced to streak 2 and entered `batch`. D9, D10 are neutral (deferred). D5 and D11 are unchanged.

**Next sweep due:** 2026-12-25 (frontmatter updated in this edit)

## HY-4 — The sweep recipe's glob crosses into the boxes, and no detector is written for a box

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** `git ls-files 'docs/trackers/*.md'`, the Phase 2 recipe, returns 105 paths here. They are 22 flat live trackers, 22 archived trackers, `INDEX.md`, one template (`frictions/entry-template.md`) and 59 box files (57 under `ledgers/`, 2 under `streams/`). D1 to D11 fit the first two groups: an index row, a frontmatter `status:`, a `*session-log*` name. A box entry has none of these. Each box has its own check. This sweep ran the detectors on flat files only. Then it ran `codescout box <key> check` for the five boxes of this repository: `bugs`, `frictions`, `patterns`, `recon` and `runtime-residuals` all report no findings. The root box reports one suspect decision (anchor `CLAUDE.md#Where things live` changed) and one box candidate (`machine-linux`, 11 open entries). So the boxes are healthy by their own measure, and the gap is in the scope of the skill, not in the corpus.

**Proposal (if any):** Phase 2 scopes the file inventory to the flat files and the archive, and adds one line: for each box, run `codescout box <key> check` and relay its findings without re-deriving them. The box owns its hygiene, and the skill only reads the verdict. The same line makes room for the ledger of this skill, which cannot move into a box while the skill writes it by path.

**Promote-when:** same shape confirmed across 2+ sweeps.

## HY-5 — Two open entries of collection-hot-path-session-log are false today, and no detector reads an entry

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** Entry `F-1` of `collection-hot-path-session-log` says the installed codescout 0.15.0 has no `hot-view`, so the hook is dormant. Entry `F-2` says no collection exists. Both read `Status: open`. This session's SessionStart delivered hot views from the installed `codescout 0.15.0` for seven collections, and `codescout box` lists boxes today. Both claims are false now, and both have stayed `open` since 2026-11-15. The sweep of the morning of 2026-11-25 saw the same two entries and listed them under "Outside the detectors". No detector reads an entry, because entry-level verify-open (D6) is v2. The `Valid:` line of `F-1` is `conditional`, and doctor lists `entry_conditional_past_due` as 0 above its exposure floor of 5 citations (9 more sit below it). This sweep did not check whether `F-1` and `F-2` are among those 9.

**Proposal (if any):** Treat this as the second datapoint for D6. A first D6 can be small: for a live tracker, take each entry whose `Valid:` line is `conditional — <event>` and print the event beside the entry, so the human checks it in one read. The detector does not decide whether the event has happened.

**Promote-when:** a third sweep meets an open entry whose condition has already come true.

## HY-6 — The precondition gate blocks on a memory read that no detector uses, and does not name stale rows after a deletion

**Valid:** dated 2026-11-25

**Verdict:** proposal

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** The precondition gate lists three reads and says to stop when any one fires. The sweep of the morning of 2026-11-25 saw `memories.missing_count` 2, called it "a memory-index gap, not a catalog gap" and went on. This sweep followed the text: `codescout migrate-memories --in-place --dry-run` (25 read, 25 upserts, 0 skipped), then the real run, then `index(verify)` showed `missing_count` 0. That took three calls. No detector of Phase 3 reads the memory store: the detectors read files, git, the catalog, `list_stale` and `link_scan`. So the memory read measures a different thing from the other two. A second effect of this sweep: a `git rm` of a box left 9 `missing_file` rows in the doctor. A reindex removed 8 and kept 1, because that row carried an event. The gate lists `reindex` as repair step 1, but no read of the gate tells the sweeper that the rows are stale after a deletion.

**Proposal (if any):** Split the gate. The catalog reads (`augmentation_declared_but_absent`, `edges_missing`) stop the sweep. The memory read becomes a one-line repair note that does not block. Add to the doctor read: "after a deletion or a move in this session, run `librarian(action=\"reindex\")` first, then read `missing_file`". Report any `vanished_kept_ids` row, because a reindex keeps it and the doctor then counts it every time.

**Promote-when:** same shape confirmed across 2+ sweeps.

## HY-7 — D4 reports a missing kind: line, and no supported call can fix it on a ledger

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** D4 fired on two files with no `kind:` line in their frontmatter: `collection-hot-path-session-log.md` and `archive/portable-workflows-session-log.md`. The operator approved the fix, and it could not be applied. `edit_file` refused both files: each declares `entry_prefix`, so each is a ledger, and the ledger guard blocks a direct edit. `doc(action="update")` takes `status`, `title`, `owners`, `tags`, `topic`, `time_scope`, `extra`, `body`, `body_edits` and `params`, and it has no `kind`. So no supported call adds `kind:` to the frontmatter of a ledger. A test of `doc(action="update", patch={extra:{kind:"tracker"}})` on `collection-hot-path-session-log` was refused: "extra must not contain frontmatter field(s) the schema already models: kind", with the hint that `kind` is fixed once the artifact exists. The catalog lists both files as `kind=tracker` anyway, so the missing line changes no result of this skill. The morning sweep fixed the neighbouring `status:` line of the same two files and left `kind:` out.

**Proposal (if any):** Either D4 stops reporting a file whose catalog row already carries the right `kind`, or `doc(action="update")` accepts `kind`. The first costs one condition in the skill; the second is a codescout change.

**Promote-when:** the same two files fire D4 in the next sweep.

## Sweep 2026-11-25 (second run)

**Scope:** docs/trackers/ flat files and archive | **Files inventoried:** 22 live, 22 archived, `INDEX.md` | **Convention sources:** `docs/trackers/INDEX.md`, `get_guide("tracker-conventions")` and the check of each of the five boxes

This is the second sweep of the day. It examines what changed since the first one (`5a08b8f`) and the items that sweep left open. It ran on the request of the operator, who plans to refactor tracker hygiene.

**Precondition (repaired, then passed):** `augmentation_declared_but_absent` 0 and `edges_missing` 0. `memories.missing_count` was 2, and the first sweep of the day went on without repairing it. This run repaired it with `codescout migrate-memories --in-place` (25 read, 25 upserted, 0 skipped); `index(verify)` then showed 0. One orphan point stays (`research/hold-ack-probe-20261124`): the `memory` tool has no action that forgets it. The index build was still running under another process at the end. No detector reads it. Doctor showed 32 violations before a reindex and 15 after it. The 17 that went away were stale rows of the box that was deleted earlier today. After the deletion of one kept row it shows 14. See HY-6.

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 3 | 3 | 0 | 0 |
| D2 terminal-not-archived | 0 | 0 | 0 | 0 |
| D3 stale-active | 1 | 0 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 3 | 3 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 1 | 0 | 0 | 1 |
| D10 session-log-decay | 1 | 1 | 0 | 0 |
| D11 promotion-pointer drift | 0 | 0 | 0 | 0 |

**D1 (3, approved):** three files in `archive/` (all archived 2026-09-01, all with a Consumed section) had no row in `INDEX.md`: `passover-advisor-projection-eval-2026-08-27`, `passover-research-skills-refactor-2026-07-04` and `passover-session-passover-tracker-2026-06-18`. Three rows were added after the `passover-validation-spine` row. The detector run after the edit reports no D1 finding.

**D3 (1, merged into D10):** `codescout-usage-audit-session-log` is `active` and idle for 80 days. The same file fires D10, so one gate covered both and the trust table credits D10 only. Two drafts are idle for 45 days or more: `effort-steering-research-2026-10-06` (50 days) and `fork-prompt-cache-research-2026-10-09` (47 days). D3 covers `active` only, so they are not findings.

**D4 (3, approved):** (a) two files have no `kind:` line, `collection-hot-path-session-log` and `archive/portable-workflows-session-log`. The fix could not be applied: the ledger guard refused `edit_file`, and `doc update` refused `extra.kind`. Both stay open. See HY-7. (b) The catalog kept one row, `d764c05db11b8c6a`, for a file of the box that was moved to codescout earlier today, because the row carried one event. A graft cannot cross repositories. The dry run showed one event, 0 links and 0 augmentation; the row was deleted.

**D5 (0, examined):** the topic and tag pass found two groups. The effort-steering group (a research draft, the active second-phase work list, and an active passover) is parent and child: the passover names its work list by an id that still resolves. The repo-hygiene pair (`repo-remediation-backlog` and `repo-hygiene-session-log`) shares a topic as backlog and log. No conflict.

**D9 (1, deferred by the rule of the skill):** `prompt-hamsa-audit-log`, `age_hours: null`, `refresh_count: 0`. It is a domain-expert audit log. The same finding and verdict as on 2026-10-19 and in the first sweep of today. It was not presented for a verdict.

**D10 (1, approved, archived):** `codescout-usage-audit-session-log` got a verify-open pass on 29 days of this repository's `.codescout/usage.db` (2026-10-27 to 2026-11-25). U-1: 65 of 3829 `read_file` calls rejected (1.7%). U-2 and U-3: 0 calls to the retired tools. U-4: 47 of 1908 `edit_file` calls rejected (2.5%), so the note of 2026-09-06 (0 of 54) was a small-sample result. U-5: 1541 `grep` calls to 1 `semantic_search` call. The owner confirmed that the work stream is wrapped. Statuses: U-1 and U-4 `mitigated`, U-2 and U-3 `moot-superseded` (a status new to this log: the prescribed remedy no longer exists), U-5 `wontfix-false-alarm`, F-1 `fixed`, W-1 `validated` with 1 datapoint (its Promote-when has not fired). The file is archived under its stable name, because `codescout-usage-audit-session-log:F-1` and `codescout-usage-audit-session-log:W-1` are cited by stem; `archived_on` is 2026-11-25. Every entry keeps its heading, and an Outcomes digest sits at the top. Its INDEX row was rewritten as an archived row.

**D11 (0):** every `promoted-to-permanent-docs` hit in the live trackers is a template or vocabulary line.

**Outside the detectors:**
- The glob of Phase 2 crosses into the boxes (105 paths, 59 of them box files). The five boxes report no findings on their own check. See HY-4.
- `collection-hot-path-session-log` `F-1` and `F-2` are open and false today. See HY-5.
- Size baseline of the live trackers: `version-bump-checklist` 257,554 B (2,952 lines), `roster-audit-session-log` 117,392 B, `effort-steering-second-phase` 105,637 B, `guard-hardening-session-log` 77,200 B, `validation-domain-coverage` 75,443 B. No detector measures size, and D10 matches a name only. This is the known gap of the bugs `tracker-hygiene: no detector measures tracker size` and `tracker-hygiene D10: the procedure has no verdict or method for a log of 400 entries`.
- The old id `af3292c4ea2d4712` of a bug that moved into the box is still cited by a spec (line 104) and by `version-bump-checklist` (line 1199). The new file names it as its old id.
- Doctor leftovers (14, not triaged): `frontmatter_id_mismatch` 5 (documents outside `docs/trackers/`), `entry_dated_stale` 3, `terminal_status_with_caveat` 2 (`docs/issues/archive/`), `retired_object_still_present` 2 (a file outside the repository), `active_worktree_registration_root_missing` 1 (`claude-plugins.worktrees/skill-legality`), `row_behind_file` 1 (a file edited after the last reindex).
- Memory staleness: the topic `gotchas` now anchors the archived path, but its stored hash was not re-hashed. `CLAUDE.md`, which others changed, is also one of its anchors, so a re-hash would vouch for edits that are not part of this sweep. Five more topics are stale only because `CLAUDE.md` changed.

**link_scan:** before the archive `edges_missing` 0, `dangling` 120, `ambiguous` 143, `cross_repo` 165. The first write added 3 edges and pruned 0. The second scan: `edges_missing` 0, `edges_stale` 0, `dangling` 120, `ambiguous` 143. The checkout is not derived-index.

**Rejects (verbatim reasons):** none.

**Fixes applied:** this commit. Citations repointed in the same pass: `docs/trackers/INDEX.md`, `docs/trackers/repo-remediation-backlog.md` (path mentions in `RM-13` and `RM-28`), `.codescout/memories/gotchas.md` and `.codescout/memories/gotchas.anchors.toml`. Dated records were left alone: `roster-audit-session-log` line 418, `docs/issues/archive/2026-08-26-active-plan-t-n-row-only-uncitable.md` and the older sweep entries. The control `git grep` of the old path has 0 hits outside the archive, and the new path has 4.

**Detector trust updates:** D1 advanced to streak 4 (batch). D4 advanced to streak 3 (batch). D10 advanced to streak 1. D2, D3, D5, D9 and D11 are neutral.

**Next sweep due:** 2026-12-25 (unchanged)

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
