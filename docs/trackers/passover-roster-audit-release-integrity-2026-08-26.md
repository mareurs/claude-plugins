---
id: eb42e9449da1708f
kind: tracker
status: active
title: Passover — roster-audit + release-integrity — 2026-08-26
tags:
- passover
- buddy-roster
- release-pipeline
- reconnaissance
topic: roster-audit-release-integrity
time_scope: dated:2026-08-26
branch: main
origin_session_id: f6ae2d77-3ee3-46f9-ab0d-270afd61c592
---

# Passover — roster-audit + release-integrity — 2026-08-26

> **Reviewed 2026-09-01 and DELIBERATELY KEPT ACTIVE.** The four sibling passovers were
> archived that day; this one was not, because its `### Still open` list holds nine live
> items and archiving it would retire a thread rather than finish it. What changed since
> 2026-08-26, measured rather than assumed:
>
> - **Item 1, cold restart:** `/reload-plugins` was run in one instance. Inherently
>   per-instance — still the queue item a session cannot do for itself.
> - **Item 2, `R-4` eval baseline:** **still n=0.** Confirmed from the reconnaissance
>   skill's own § *Skill maintenance*, which reads *"Bootstrap: cases pinned, baseline not
>   yet run (n=0)."* Note the sequencing advice here — *"do not promote a third law first"*
>   — was partly overtaken: `R-5` was promoted 2026-08-26 on a **targeted screen**
>   (control 0/3 and the skill 0/3 on `reconnaissance-eval/scenarios/instrument/self-validating-gate`),
>   not on this baseline. So the gate held for `R-6` but not for `R-5`, and the list's
>   stated ordering no longer describes what happened.
> - **Item 6, ambiguous citations:** this file records **93** on 2026-08-26. Now **64** —
>   but not from the sweep it prescribes. A `T` prefix collision, introduced and fixed on
>   2026-09-01, was breaking ~31 pre-existing `T-N` citations across `INDEX.md` and two
>   passovers; removing it did the arithmetic. **The bare-`F-N`/`W-N` sweep this item asks
>   for is still entirely undone**, and the improved number must not be read as progress on
>   it. `prefix_conflicts` is back to 0.
> - **Release state:** the machine-state line below says `buddy 0.9.1` and
>   `codescout-companion 1.16.17`. Both are stale — now **0.11.0** and **1.20.0**, parity
>   green across three profiles.
> - **Uncommitted files** in § *Working state*: both long since committed. `origin/main` is
>   level with `HEAD`.
> - **Item 9, the two codescout upstream fixes:** `roster-audit-session-log:F-6`'s proposed
>   `doctor` check `cited_prefix_with_no_definer` **now exists and runs** — it appears in
>   `librarian(action="doctor")`'s `by_check` map (currently 0). So that half is applied
>   upstream, not merely filed.
>
> Items 3, 4, 5, 7 and 8 are unchanged and unverified as of this review — they were not
> re-measured, only left alone. Do not read this note as clearing them.

## State

Two threads, both at a clean stopping point. **(1) Roster audit:** a cross-repo research handoff proposing `validation-domain-coverage.md` was verified against `buddy/skills/` source — every quantitative claim held, and six frictions came out of the surrounding trackers and tooling (`roster-audit-session-log` `roster-audit-session-log:F-1`..`roster-audit-session-log:F-8`, `roster-audit-session-log:W-1`, `roster-audit-session-log:W-2`). Four issues filed in this repo, two in codescout. **(2) Release integrity:** `codescout-companion` **1.16.17 is released and pushed**; the release exposed a three-way blind spot in the release gate, now fixed and shipped as `scripts/check-profile-parity.sh`. `VG-7` (pheasant lens re-extraction) is **done and committed but NOT released** — it changes shipped `buddy` content and needs a `buddy` version bump.

Two of this session's own findings were **filed wrong and corrected the same day** — `roster-audit-session-log:F-4` (claimed dangling where the truth was "inert") and the `VG-7` metric. Both corrections are recorded in place rather than overwritten, because the mechanism is the reusable part. Read `roster-audit-session-log:W-2` before trusting any instrument in this repo.

**Update 2026-08-26, post-compaction.** `VG-6` is **closed** — `testing-snow-leopard`
gained a `## Properties and Invariants` section (125 → 148 lines) plus a `**Properties:**`
field and Heuristic 9. The scout before that edit paid for itself twice: the drafted
content's lead instruction (*"Prefer invariants to examples"*) would have suppressed the
exact boundary enumeration the skill's own eval scores, and the eval cites the skill by
positional anchor, so inserting into any numbered list would have silently re-pointed its
references. Both recorded under `VG-6`.

`#21` needed **no work at all** — it shipped 2026-05-15 in `f97f2a4` and has been live
through ~44 buddy bumps. It appeared in this passover's own action list as pending because
the queue was built from `buddy-introspection`'s `Status` column, where `open` encodes
*"not eval-confirmed"* rather than *"not done"*. That is `roster-audit-session-log:F-9`, and it is why every Next
action now states how it was verified. A third of this thread's findings are now about
reading a tracker's own field as ground truth — `roster-audit-session-log:F-1`, `roster-audit-session-log:F-4`, `roster-audit-session-log:F-9`, and the stale
"not yet shipped" note on `roster-audit-session-log:F-3`'s own Index row, corrected in the same pass.

## Next actions

> **Every item states how it was verified and when.** An item tagged `[UNVERIFIED]` is a
> claim inherited from an earlier session, not a measurement — check it before executing it.
> This convention exists because the first draft of this list told a fresh session to add an
> LLM taxonomy sub-section to `security-ibex` that had shipped three months earlier. See
> `roster-audit-session-log:F-9`.

**✅ CLEARED 2026-08-26 (all pushed, `origin/main` at `5c379a0`, tree clean).** Nothing in
the original seven-item list is outstanding:

| was | outcome |
|---|---|
| push | done — `ce83dfd → 31d1486 → 5c379a0` |
| `VG-6` | done — `## Properties and Invariants` in `testing-snow-leopard` (125 → 148 lines), `452496b` |
| `#21` | **needed no work** — shipped 2026-05-15 in `f97f2a4`. This item was the bug; `roster-audit-session-log:F-9` |
| release | done — **buddy 0.9.2**, carrying `VG-7` + `VG-6`. Parity green across 3 profiles |
| `roster-audit-session-log:F-1`/`roster-audit-session-log:F-2` | done — `#20` re-opened with the measured distribution, audit re-scoped `10/10 → 10/12`, `d334a50` |
| `roster-audit-session-log:F-4` | done — all 38 `T-N` defined in one commit, resolution proven by edges, `5c379a0` |
| version-bump tracker | refreshed for 0.9.2; its plugin set now **derived**, not hardcoded, `c1155e8` |

### Still open — nothing blocking, in rough priority order

1. **COLD-RESTART all three Claude Code instances.** buddy 0.9.2 is on disk and in all three
   install records, but hooks resolve `installPath` at process launch, so a `resume` keeps
   serving 0.9.1. Fully quit + relaunch, or `/reload-plugins`. Confirm via the SessionStart
   payload: a true cold start reports `source=startup`.
   `[the one queue item a session cannot do for itself]`

2. **`R-4` eval baseline — the gate three laws are parked behind.** `buddy/tests/reconnaissance-eval`
   has cases pinned and a baseline of **n=0**, so `R-4`'s behavioural effect is unmeasured.
   `R-5` (this thread) and `R-6` (the concurrent validation-spine thread) are both HELD on
   that. Sequence: run the baseline → score `R-4` → then adjudicate `R-5`/`R-6`. Do not
   promote a third law first.
   `[verified 2026-08-26 — both entries read as held; R-4 reads promoted, effect unmeasured]`

3. **`T-14` — a task recorded as shipped that is not in the skill.** `f97f2a4`'s subject
   names "T-12..T-22", but `testing-snow-leopard` Method step 4 still reads *"One arrange /
   act / assert per test"* with no Given-When-Then alternative, and `#10` still reads `open`.
   Either do the reframe or mark `T-14` explicitly not-done. `VG-6` touched the same skill and
   deliberately did **not** close `#10`.
   `[verified 2026-08-26 — read Method step 4 directly; #10 row still open]`

4. **Two shipped changes no eval measures.** `VG-6`'s property vocabulary and `#21`'s LLM
   taxonomy both ship unmeasured. `testing-snow-leopard-eval` scores boundary-and-observable
   + tautology-detection; `security-ibex-eval` has `idor` + `precision-clean`. Neither touches
   the new content. Note `S-5` is now closed — all 12 specialists have eval sets — so "no
   harness exists" is no longer the excuse; per-finding coverage is.
   `[verified 2026-08-26 — read all four scenario.yaml + both prompt_tdd.yaml]`

5. **`T-35` quarterly hamsa sweep — overdue since 2026-08-15**, and its scope needs widening
   before it runs: written for ten specialists, roster is twelve, and it inherits `#20`'s
   re-opened length finding. `codescout-pika` (316 lines) must be audited before `#20`'s
   verdict can be re-derived at all — "is 181 lines justified?" is a question about rank.
   `[verified 2026-08-26 — line counts measured across all 12; T-35 cadence date read from the plan]`

6. **~90 ambiguous citations — a bounded, mechanical sweep.** Bare `F-N`/`W-N` tokens, whose
   namespaces are per-work-stream so a bare token has many definers and resolves to none. Fix
   is `<file-stem>:F-N`. Three of mine were fixed in `5c379a0`; the rest predate today.
   `[verified 2026-08-26 — link_scan ambiguous 93, prefix_conflicts 0, edges_missing 0]`

7. **`VG-1`–`VG-5`** — unblocked now that `VG-6`/`VG-7`/`VG-8` are closed. Clone `VG-7`'s
   *question*, not its ratio: `roster-audit-session-log:F-8` established that metric is algebraically invariant under
   the fix it prescribes.
   `[verified 2026-08-26 — roster-audit-session-log:F-8 arithmetic recorded in the entry]`

8. **Marketplace clones have no sync mechanism.** `roster-audit-session-log:F-10` was repaired by a one-time
   `rsync` from `~/.claude`; nothing keeps the three profiles' marketplace clones current,
   so HEAD skew reappears whenever one profile auto-updates and another does not. The gate
   now **detects** it (class 7) and never repairs it — deliberately, since choosing which
   profile is canonical is a judgement call. Blind spot: `claude-plugins-official` is not a
   git clone in any profile, so class 7 cannot see its staleness at all (kat's copy was 180
   plugins against `.claude`'s 289 before the sync, visible only as a file count).
   `[verified 2026-08-26 — parity green after the fix; positive control fired all four new classes]`

9. **Two codescout upstream fixes, filed not applied** — `roster-audit-session-log:F-5` (the session-log template
   cites its own ledger ids bare, so every copy imports dangling citations) and `roster-audit-session-log:F-6` (a
   `doctor` check `cited_prefix_with_no_definer`; `roster-audit-session-log:F-4` is the instance, this is the class).
   Both are issues on codescout's `experiments` branch.
   `[verified 2026-08-26 — both issue files exist; neither fix applied]`
## Working state

- **Branch / commit / clean-or-dirty:** `main`, local HEAD ahead of `origin/main` by the tracker commits + `0fd8eb1`. Working tree has only the items below.
- **Files changed, uncommitted:**
  - `docs/trackers/INDEX.md` — **WIP, shared.** Contains a row from a *concurrent session* (`passover-validation-spine-2026-08-26.md`) as well as mine. Committing it commits their row too.
  - `docs/trackers/passover-validation-spine-2026-08-26.md` — **KEEP, not mine.** Written by a concurrent session on the VG-9 spine-measurement thread. Left untracked deliberately; do not fold it into an unrelated commit.
- **Processes / servers that must be running:** none. codescout MCP is the only dependency.
- **Machine state:** all three profiles carry `codescout-companion 1.16.17` / `buddy 0.9.1` / `claude-statusline 1.1.7` / `session-bridge 0.1.0`, one user-scope element each; `check-profile-parity.sh` green. Six stale `installed_plugins.json.bak*` files were removed on request — no backups remain.

## Anti-goals

- **Do not measure lens-split quality with `(base + lens) / monolith`.** It is invariant under relocation — the exact fix it prescribes cannot move it (`roster-audit-session-log:F-8`). Use absolute lines per summon. And do not clone `VG-7`'s "addendum approaching base size" rule to `VG-1`/`VG-5` as a numeric gate: post-extraction `_llm.md` is 118 vs a 141-line base and every remaining line is legitimately LLM-specific. It is a smell, not a law.
- **Do not treat `T-N` citations as dangling.** They are inert — prefix `T` has zero definers, so `link_scan` never considers the token. `dangling_by_source` will not show them. This was filed wrong once already.
- **Do not read `link_scan`'s `ambiguous` / `dangling` arrays as a census.** Capped at 50 against populations of 70–81, with no `truncated` flag. Use `*_by_source`.
- **Do not auto-repoint every install-record element in `release.sh` step 5.** A project-scope pin may be deliberate elsewhere; `check-profile-parity.sh` deliberately detects and fails rather than rewriting.
- **Do not trust `CLAUDE.md`'s Windows section for profile state.** It is now labelled, but it asserts there is no `claude` binary and that two profiles are empty scaffolds — false here. The accurate section sits above it.
- **Do not put a second law into the reconnaissance Phase 1 bullet yet.** `R-4` shipped in 1.16.17 and is unmeasured (`buddy/tests/reconnaissance-eval` baseline n=0). `R-5` is deliberately held at `proposal` until that baseline exists.

## Open threads

- `roster-audit-session-log:F-5` / `roster-audit-session-log:F-6` — both filed as codescout issues; upstream fixes not applied. `roster-audit-session-log:F-6` proposes a `doctor` check, `cited_prefix_with_no_definer`.
- `roster-audit-session-log:F-3`'s owed regression: parse every `**Valid:**` / `**Rests on:**` line in `codescout-companion/skills/**` against the documented grammar. No MCP server needed; would have caught the 2026-08-20 regression at its own commit.
- `R-4` effect unmeasured — establishing the `reconnaissance-eval` baseline is the work it generates.
- `caveman@caveman` is still a registered marketplace in `~/.claude` and `~/.claude-kat` with nothing installed from it. Cosmetic; outside the agreed parity scope (our 4 plugins).
- `sdd` 2.4.1 is installed in no profile, and § Installing documents marketplace `claude-plugins` while everything real uses `sdd-misc-plugins`.

## Pointers

- Specs / plans / related trackers: `docs/trackers/roster-audit-session-log.md` (this session's ledger, `roster-audit-session-log:F-1`..`roster-audit-session-log:F-8`, `roster-audit-session-log:W-1`, `roster-audit-session-log:W-2`), `docs/trackers/reconnaissance-patterns.md` (`R-3`, `R-4`, `R-5`), `docs/trackers/validation-domain-coverage.md` (`VG-1`..`VG-10`), `docs/trackers/buddy-introspection.md` (`#20`, `#21`, `S-5`), `docs/trackers/active-plan.md` (`T-35`, `T-37`, `D-6`), `buddy/docs/trackers/headroom-optimization.md` (backlog 2b, re-scoped), `docs/trackers/version-bump-checklist.md` (`cc8cb9e23ab5cc67`).
- Sibling thread: `docs/trackers/archive/passover-validation-spine-2026-08-26.md` — concurrent session, VG-9 spine measurement; **archived 2026-09-01**, its one open action now tracked as `repo-remediation-backlog` `RM-10`. Different thread; its anti-goals are its own.
- Key commits: `f53aaea` (recon SKILL fix), `448a1b8` (1.16.17 bump), `cb7d3f4` (tracker refresh), `ce83dfd` (parity check + CLAUDE.md), `0fd8eb1` (VG-7).
- Back-link: `.buddy/f6ae2d77-3ee3-46f9-ab0d-270afd61c592/` and the session transcript.
