# Session Log — pi-agent-integration

Work-stream session log for the pi.dev / pi-agent integration effort (the
`feat/pi-agent-integration` and `feat/research-fanout-mode` branches and PR #3).
Reconnaissance frictions (F-N) and wins (W-N) captured here are portable across the
parallel sessions working this stream.

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-06-21 | med | git-coordination | fixed-verified | Both feature branches forked off a local main 4 behind origin/main (Windows/Copilot/0.7.28) |
| F-2 | 2026-06-21 | high | git-coordination | fixed-verified | Interrupted interactive rebase of `main` onto origin/main (started elsewhere); aborted, main rewritten feature-only |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-06-21 | med | scout the full divergence triangle before push/merge | greenlit PR #3 / pushed fan-out while branches silently lacked origin/main's Windows+Copilot fixes | validated |

---

## Category conventions

| Category | When to use |
|---|---|
| `git-coordination` | Branch / remote / PR divergence across parallel sessions |
| `skill-loading` | buddy / Agent-Skills frontmatter + name-casing load issues |
| `architectural` | Structural property the plan/docs didn't surface |
| `self-friction` | Predicted friction that turned out to be a false alarm |

Add a new category by writing it as a kebab-case string; no central registry needed.

---

## Status vocabulary

### Friction statuses
`open` (observed, unresolved — default) · `mitigated` (workaround in place) ·
`fixed-verified` (fix landed AND confirmed) · `wontfix-false-alarm` ·
`promoted-to-bug-tracker` · `pinned-as-eval-baseline`.

### Win statuses
`validated` (≥1 counterfactual datapoint — default) · `promoted-to-permanent-docs` ·
`archived`.

---

## F-1 — Both feature branches forked off a local main that is 4 commits behind origin/main

**Observed:** 2026-06-21, reconnaissance scout during a PR/branch status check for the
pi.dev integration work, before pushing `feat/research-fanout-mode` or advising on PR #3.

**When:** About to recommend pushing the fan-out branch and/or merging PR #3.

**Expected (my prior report):** The only meaningful divergence was feature-branch vs
feature-branch; I implied `origin/main` was simply *behind* local `main`.

**Got (scouted reality):** Local `main` (`40e4bd6`) is **ahead of `origin/main` by 12
AND behind by 4** — they have genuinely diverged. The 4 commits on `origin/main`
(`b201e0d`) absent from local main:
- `e8966ff` / `7533c61` — drop `name:` frontmatter from commands so Copilot CLI loads them
- `bd7bd43` — **chore: bump buddy to 0.7.28**
- `b201e0d` — run hooks via no-arg `.cmd` polyglot wrappers (Windows) + guard fcntl

Both `feat/research-fanout-mode` and `feat/pi-agent-integration` were forked from local
main `40e4bd6`, so **neither branch contains those 4 commits**. `git range-diff
40e4bd6..a6e447c 40e4bd6..8d6b7c8` confirms the `fix(buddy): lowercase skill names`
commits are byte-identical (`=`) on *both* branches — and that change touches buddy
command/skill frontmatter, the **same surface** as origin/main's Copilot/Windows fixes.

**Probable cause:** Parallel sessions — one pushed buddy 0.7.28 + cross-platform fixes to
`origin/main`; another branched feature work off an unpushed local main and committed the
same lowercase fix independently on two branches.

**Workaround:** Before any push/merge: reconcile `main` first (integrate origin/main's 4
commits into local main), then rebase both feature branches onto the updated main, and
drop one copy of the duplicate buddy commit. Hold the fan-out push until reconciled.

**Severity:** med — PR #3 would merge 12 unpushed main commits + a buddy frontmatter change
against an `origin/main` that diverged by 4 on the overlapping buddy surface; likely a
merge conflict, or branches that ship without the Windows `.cmd` wrappers / Copilot
frontmatter fixes (a cross-platform regression). Controller-absorbable but needs an
explicit reconcile step, not a blind push.

**Decision (2026-06-21):** Keep the Windows / Copilot / buddy-0.7.28 track separate; do
NOT reconcile `origin/main` into the feature line for now. The feature branches knowingly
run without those 4 fixes for the duration of this work. Revisit only before a deliberate
cross-merge to main — do not auto-reconcile.

**Decision (2026-06-21, revised — supersedes above):** User chose to exclude ALL Windows
work from `main`, not merely defer it. `main` is reset to the feature-only line
(`671b725` + cherry-picked fan-out doc `0e7ef51`) and **force-pushed**; the Windows
commits (`b201e0d`, `7533c61`, `bd7bd43`, `e8966ff`) are dropped from `main` but preserved
on `origin/fix/copilot-cli-command-name-load`, and `fix/windows-tool-name-drift` stays
unmerged. Consequence: `main`'s buddy version returns to 0.7.27 (the 0.7.28 bump rode the
Windows track). See F-2.

**Status:** fixed-verified — divergence resolved by purging Windows from `main`.

**Fix idea / Pointer:** When a cross-merge is wanted: reconcile main ↔ origin/main, rebase `feat/pi-agent-integration`
and `feat/research-fanout-mode`, de-duplicate the buddy lowercase commit. PR #3.

---

## W-1 — Pre-push scout of the full divergence triangle caught branches missing origin/main fixes

**Observed:** 2026-06-21, before pushing `feat/research-fanout-mode` / advising PR #3 merge.

**Pattern:** Before pushing a local feature branch or greenlighting a PR merge, scout the
**full divergence triangle**, not just feature-branch-vs-feature-branch: run
`git log main..origin/main` (commits the branches are *missing*) and `git range-diff` to
confirm whether "duplicate" commits across branches are truly identical (`=`) rather than
merely same-file-count.

**Counterfactual:** Without this scout I'd have pushed the fan-out branch and/or
greenlit PR #3 while both branches silently lacked `origin/main`'s buddy 0.7.28 + Windows
`.cmd` wrappers + Copilot frontmatter fixes — risking either a merge conflict on the
overlapping buddy-frontmatter surface or shipping a cross-platform regression. The
"identical commits" claim was stat-level (same 9 files) until `range-diff` proved `=`.

**Confirming data points:**
1. F-1 (this session) — local main 4 behind origin/main; both feature branches forked off
   the stale main; duplicate buddy commit confirmed identical via range-diff.

**Impact:** med — prevents one surprise merge conflict / cross-platform regression and a
wasted push.

**Promote-when:** A second pre-merge scout catches a missing-from-branch origin/main
divergence → promote to CLAUDE.md: "before pushing/merging, scout local-main vs
origin-main in both directions and range-diff suspected duplicate commits."

**Status:** validated — single datapoint, divergence caught before any push.

---

## F-2 — Interrupted interactive rebase of `main` onto origin/main, stopped on README conflict (started by a parallel session)

**Observed:** 2026-06-21, scouting before a "merge everything to master except Windows" request.

**When:** About to merge the feature work to main.

**Got:** HEAD was detached in an in-progress interactive rebase: branch `main`
(`orig-head` = `671b725`, 18 ahead of origin/main) being rebased **onto `b201e0d`**
(origin/main = the Windows base). 16 picks done, 0 remaining, stopped on a `README.md`
conflict (buddy version + pi-companion row). This session did NOT start it — `main` had
moved `40e4bd6`→`671b725` since the last scout, so a **parallel session** began the
reconcile and paused.

**Probable cause:** A parallel session started reconciling local main onto origin/main and
parked at the README conflict; this session found the half-finished rebase.

**Workaround / resolution:** Confirmed (a) the other session was stopped and this session
had sole git control, and (b) the 4 Windows commits are preserved on
`origin/fix/copilot-cli-command-name-load` so a rewrite would not orphan them. Per the
user's exclude-all-Windows choice: `git rebase --abort` (main → `671b725`), cherry-picked
the fan-out doc, force-pushed `main` feature-only.

**Severity:** high — acting on an interrupted cross-session rebase risks lost/clobbered
commits; resolved only after verifying sole control + Windows-commit preservation.

**Status:** fixed-verified — rebase aborted cleanly; main rebuilt feature-only and pushed.

**Fix idea / Pointer:** Coordinate sessions before any rebase on a shared branch. W-1.

---
## Template for new entries

Copy the F-N / W-N block above, allocate the next free monotonic ID (separate F and W
counters), and add a matching row to the Index / Wins Index table.
