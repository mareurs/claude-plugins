# Trackers — Index

This directory holds active project trackers in two families:

1. **Buddy-specialist introspection-and-rewrite initiative** — the
   audit/plan/eval chain (`buddy-introspection`, `active-plan`,
   `eval-bringup`, `fixture-expansion`).
2. **Standalone reconnaissance session-logs** — per-work-stream F-N/W-N
   ledgers (`injection-budget`, `release-hygiene`, `guard-hardening`,
   `skill-loading`, `codescout-usage-audit`), independent of the initiative above.

Plus the release-gating `version-bump-checklist` (a librarian-managed
`kind=tracker` artifact — edit via artifact tools, not markdown tools).

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
| [injection-budget-session-log.md](injection-budget-session-log.md) | Reconnaissance session-log for the injection-budget work stream. Friction (F-1..F-4) + wins (W-1, W-2) ledger: hook conventions, test naming, Skill channel capacity, edit_code matcher drift. | open | standalone (recon ledger) |
| [release-hygiene-session-log.md](release-hygiene-session-log.md) | Reconnaissance session-log for the plugin publishing / release-hygiene work stream. W-1: read a lockfile (+ its manifest) before committing — caught a stray empty `buddy/uv.lock` pinning a `requires-python` that contradicted documented runtime. | open | standalone (recon ledger) |
| [guard-hardening-session-log.md](guard-hardening-session-log.md) | Reconnaissance session-log for the pre-tool-guard cross-repo hardening work stream. F-1: cross-repo escape lives in the markdown + Bash branches, not `is_in_workspace` (fixed-verified, `ad9073d` + `e70d783`). | open | standalone (recon ledger) |
| [skill-loading-session-log.md](skill-loading-session-log.md) | Reconnaissance session-log for the skill-loading work stream. F-1 (Skill bypasses the tool-hook pipeline), W-1 (pre-spec recon validated all 5 load-bearing mechanisms), F-2 (compact replay inflates ledger counts). | open | standalone (recon ledger) |
| [codescout-usage-audit-session-log.md](codescout-usage-audit-session-log.md) | Pika+Dzo audit of `.codescout/usage.db` (5961 calls). U-1..U-5 (wrong-tool routing, server-enforced), F-1 (un-backfilled columns mislead scoping), W-1 (Dzo re-read refuted a stale `statusline.py` target). | open | standalone (recon ledger) |
| [version-bump-checklist.md](version-bump-checklist.md) | Librarian-managed artifact (`id=cc8cb9e23ab5cc67`, kind=tracker). Release readiness across plugins × profiles — gate before any version bump. Edit via artifact tools, not markdown tools. | draft | gates version bumps |
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

- Tracker files open with a structured **live-state YAML block** (fenced).
- Each tracker has a **Done-condition** section stating when it closes.
- Each tracker has a **History** section with dated entries (most-recent
  first, prepended).
- When a tracker reaches done-condition, set `status: closed` in live-state
  and link forward to whatever supersedes or references it.
- Cross-tracker references use relative markdown links.

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
