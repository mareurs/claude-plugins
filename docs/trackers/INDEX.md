---
status: active
title: Trackers — Index
kind: index
---
# Trackers — Index

This directory holds active project trackers in two families:

1. **Buddy-specialist introspection-and-rewrite initiative** — the
   audit/plan/eval chain (`buddy-introspection`, `active-plan`,
   `eval-bringup`, `fixture-expansion`, `buddy-learning-and-model-drift`).
2. **Standalone reconnaissance session-logs** — per-work-stream F-N/W-N
   ledgers (`injection-budget`, `release-hygiene`, `guard-hardening`,
   `skill-loading`, `codescout-usage-audit`), independent of the initiative above.

Plus the release-gating `version-bump-checklist` (a librarian-managed
`kind=tracker` artifact — edit via artifact tools, not markdown tools).

And `validation-domain-coverage` (VG-N), a second audit axis over the same specialists:
where `buddy-introspection` asks whether a specialist is *written* well, that one asks
which subject-matter competencies the roster leaves *unowned*. Orthogonal — a specialist
can pass every hamsa heuristic and still leave a domain with no owner.

Each tracker is markdown with a structured live-state block (or
Index/Wins tables for the recon ledgers), a done-condition, body
sections, and a dated history. Promote the plain-markdown ones to
codescout artifacts (`kind=tracker`) once `claude-plugins` is registered
as an artifact repo.

## Active trackers

| Tracker | Purpose | Status | Blocks / Blocked by |
|---------|---------|:------:|---------------------|
| [buddy-introspection.md](buddy-introspection.md) | Hamsa-lens audit of all 10 buddy specialists. Gap inventory: 6 systemic (S-1..S-6) + 14 unique per-specialist issues + 1 positive pattern + cross-promote table. | open | blocks active-plan |
| [active-plan.md](active-plan.md) | 38-task plan in 4 phases for resolving every issue in buddy-introspection.md and establishing eval grounds. Source of truth for what to do next. | open | blocks eval-bringup; depends on buddy-introspection |
| [eval-bringup.md](eval-bringup.md) | Runtime bringup tracker for the eval harness — env setup, first executions, calibration loop. Subset focus of active-plan Phase 0 (T-6..T-11 specifically). | open | depends on active-plan setup work (T-1..T-5) |
| [fixture-expansion.md](fixture-expansion.md) | Deferred T-9: author 5 fixtures + baseline + κ-calibrate for 9 remaining specialists. Backfilled on-demand as Phase 2/3 refactors each specialist. | open | blocks Phase-2/3 completion for non-takin specialists |
| [buddy-learning-and-model-drift.md](buddy-learning-and-model-drift.md) | New scope beyond the audit: recon-style F-N/W-N + project/system promotion for specialists, versioned model-aware staleness tracking, cross-model (opus-5 vs sonnet-5) differential eval. Also flags active-plan.md's 90-day resweep threshold as already exceeded. | draft | depends on buddy-introspection + active-plan + eval-bringup |
| [archive/injection-budget-session-log-2026-09-05.md](archive/injection-budget-session-log-2026-09-05.md) | **Archived 2026-09-05** — work stream wrapped, all 4 frictions fixed-verified, both wins validated (promote-when unmet, 1/2 datapoints each). | archived | standalone (recon ledger) |
| [archive/release-hygiene-session-log-2026-09-05.md](archive/release-hygiene-session-log-2026-09-05.md) | **Archived 2026-09-05** — one win recorded and validated, zero open frictions. | archived | standalone (recon ledger) |
| [guard-hardening-session-log.md](guard-hardening-session-log.md) | Reconnaissance session-log for the pre-tool-guard cross-repo hardening work stream. `guard-hardening-session-log:F-1`: cross-repo escape lives in the markdown + Bash branches, not `is_in_workspace` (fixed-verified, `ad9073d` + `e70d783`). | open | standalone (recon ledger) |
| [skill-loading-session-log.md](skill-loading-session-log.md) | Reconnaissance session-log for the skill-loading work stream. `skill-loading-session-log:F-1` (Skill bypasses the tool-hook pipeline), `skill-loading-session-log:W-1` (pre-spec recon validated all 5 load-bearing mechanisms), `skill-loading-session-log:F-2` (compact replay inflates ledger counts). | open | standalone (recon ledger) |
| [archive/research-skills-refactor-session-log-2026-09-05.md](archive/research-skills-refactor-session-log-2026-09-05.md) | **Archived 2026-09-05** — F-1 mitigated, F-2 fixed-verified, no wins. | archived | standalone (recon ledger) |
| [archive/pi-agent-integration-session-log-2026-09-05.md](archive/pi-agent-integration-session-log-2026-09-05.md) | **Archived 2026-09-05** — both frictions fixed-verified, win validated (promote-when unmet, 1/2 datapoints). | archived | standalone (recon ledger) |
| [session-passover-impl-session-log.md](session-passover-impl-session-log.md) | Session log for the session-passover-tracker implementation work stream. | active | standalone (recon ledger) |
| [roster-audit-session-log.md](roster-audit-session-log.md) | Reconnaissance session-log for the buddy-roster audit work stream. `roster-audit-session-log:F-1` (a drift finding re-measured its own title; `#20`'s 3×-baseline claim is falsified — the audited ten are 118–136 lines and `codescout-pika` is 316), `roster-audit-session-log:F-2` (`buddy-introspection` says `specialists_scanned: 10/10` against a roster of 12; `codescout-pika` + `prompt-hamsa` never audited), `roster-audit-session-log:F-3` (recon skill's `**Valid:**` exemplar is rejected by `append_entry`), `roster-audit-session-log:W-1` (audit the cited claim, not the quoted number). | open | standalone (recon ledger); `roster-audit-session-log:F-1`/`roster-audit-session-log:F-2` feed buddy-introspection + active-plan T-35; `roster-audit-session-log:W-1` promoted-from at reconnaissance-patterns R-3 |
| [codescout-usage-audit-session-log.md](codescout-usage-audit-session-log.md) | Pika+Dzo audit of `.codescout/usage.db` (5961 calls). **U-1..U-5 recommend `read_markdown`/`edit_markdown` — both retired by the 2026-09-02 tool collapse; needs re-audit against current tool names before any of these can close.** `codescout-usage-audit-session-log:F-1` fixed. `codescout-usage-audit-session-log:W-1` validated. | open | standalone (recon ledger) |
| [version-bump-checklist.md](version-bump-checklist.md) | Librarian-managed artifact (`id=cc8cb9e23ab5cc67`, kind=tracker). Release readiness across plugins × profiles — gate before any version bump. Edit via artifact tools, not markdown tools. | draft | gates version bumps |
| [validation-domain-coverage.md](validation-domain-coverage.md) | Domain-coverage audit of the roster for AI-eng / data-science **validation** competencies (VG-1..VG-10). 14 surveyed: 4 held, 4 partial, 6 unowned. Proposes 2 *new* specialists (data-contract, eval-harness-teaching) — the first additive proposals on this roster. Also carries the reusable prompt spine for getting an agent to write validation that can fail — rewritten 2026-08-26 to outcome framing and **unmeasured**, see VG-9. | open | VG-7 feeds headroom-optimization 2b; VG-9 ablation belongs in buddy-learning-and-model-drift; VG-10 amends D-6 in active-plan; VG-5 adjacent to S-5 |
| [passover-roster-audit-release-integrity-2026-08-26.md](passover-roster-audit-release-integrity-2026-08-26.md) | Handoff for the roster-audit + release-integrity thread. codescout-companion 1.16.17 released; VG-7 committed but NOT released (needs a buddy bump, batch with VG-6 + #21). Carries the anti-goals: `T-N` citations are **inert not dangling**, `link_scan`'s finding arrays are capped at 50, and the lens-split ratio is invariant under relocation. | active | depends on roster-audit-session-log + validation-domain-coverage; sibling of passover-validation-spine |
| [archive/passover-validation-spine-2026-08-26.md](archive/passover-validation-spine-2026-08-26.md) | **Archived 2026-09-01.** Handoff for the VG-9 spine-ablation measurement: verdict UNRESOLVED, the four prompt-tdd defects found building it (OP-13..OP-16), and the anti-goals — **do not use `--paired`, do not run `prompt-tdd report`**. Its one open action *is* `VG-9`'s condition and is tracked as `repo-remediation-backlog` `RM-10`, which repeats those anti-goals inline. Still the place to read the method detail before resuming any spine measurement. | archived | superseded as a queue by `RM-10`; method detail still live |
| [repo-remediation-backlog.md](repo-remediation-backlog.md) | Remediation queue (`RM-1`..`RM-24`), opened 2026-09-01 from an open-issues sweep. Closed so far: `RM-21` (`run-all.sh` was exiting 1 — the pre-push guard's positive control could not fire), `RM-1`/`RM-2` (two unterminated fences), `RM-5` (push), `RM-11` (4 of 5 passovers archived, 1 kept active). Still open: 8 terminal records with no fix anchor, `prompt-hamsa-audit-log` defining no citable token, 7 undeclared load-bearing entries, two past-due conditionals, the archive backlog, pointer entries into the `U-N`/`F-N`/`VG-N` ledgers, and 4 cross-repo items. **Prose ledger** — `## RM-N — <title>` headings only, no params rows, no hand-maintained index. | active | `RM-12` blocked on `RM-7`; pointers into codescout-usage-audit, roster-audit, validation-domain-coverage, repo-hygiene |
## Relationships

```
buddy-introspection.md   names the gaps  →  feeds  →
                                              active-plan.md (resolves them)  →  spawns  →
                                                                    eval-bringup.md (runs the harness)
```

- **buddy-introspection.md** is the audit — it changes only when a hamsa
  sweep finds new gaps or invalidates old ones (see its § Self-Inspection
  Grounds for triggers).
- **active-plan.md** is the work plan — it changes continuously as tasks
  complete; phase-end is the natural compaction point.
- **eval-bringup.md** is the runbook — it tracks one-time bringup of the
  eval harness; closes when the harness is producing baselines on every PR.

## Conventions

**Migrated 2026-09-05 to librarian frontmatter.** These files used to open with a
fenced `live-state` YAML block and a hand-maintained status column here, as a
deliberate plain-markdown fallback while `claude-plugins` was not yet registered
as a codescout artifact repo (see each file's own history for that era's detail).
That precondition is now met, so every tracker under this directory carries real
YAML frontmatter (`kind: tracker`, `status:`, `title:`) and is queryable via
`doc(action="find", kind="tracker")` rather than only through this table.

- Every tracker's frontmatter carries `kind: tracker`, `status:` (`active` |
  `draft` | `archived` | `superseded` — see `get_guide("tracker-conventions")`),
  and `title:`.
- A ledger (one that allocates `F-N`/`W-N`/`T-N` ids) additionally declares
  `entry_prefix:` — this is what guards it against direct hand-edits; see
  `get_guide("tracker-conventions")` § Entry ids.
- Each tracker still has a **Done-condition** section stating when it closes,
  and a **History** section with dated entries (most-recent first, prepended) —
  those conventions are unchanged by the frontmatter migration.
- When a tracker reaches its done-condition, set `status: archived` through the
  catalog (`doc(action="update", id=..., patch={status:"archived"})`), never a
  raw frontmatter edit — link forward to whatever supersedes or references it.
- Cross-tracker references use relative markdown links, or an entry id
  (`F-3`, `T-12`) per `get_guide("tracker-conventions")` § Citing an entry.
- This table is now a curated map, not the source of truth for status — a
  tracker's frontmatter is authoritative; keep this table's Status column in
  sync by convention, not by construction.
## How to add a new tracker

1. Decide if it deserves its own file or belongs as a section in an existing
   tracker. Default to extending an existing one — fewer files, less rot.
2. If a new file is justified: create `docs/trackers/<slug>.md` with title,
   live-state YAML, done-condition, body, history.
3. **Add a row to the table above.** Trackers that aren't indexed are
   invisible.
4. Reference from other trackers if there's a dependency edge.

## See also

- `eval/README.md` — eval harness layout and quick-start
- `buddy/skills/*` — the 10 specialists being audited and rewritten
