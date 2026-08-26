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

## State

Two threads, both at a clean stopping point. **(1) Roster audit:** a cross-repo research handoff proposing `validation-domain-coverage.md` was verified against `buddy/skills/` source — every quantitative claim held, and six frictions came out of the surrounding trackers and tooling (`roster-audit-session-log` `F-1`..`F-8`, `W-1`, `W-2`). Four issues filed in this repo, two in codescout. **(2) Release integrity:** `codescout-companion` **1.16.17 is released and pushed**; the release exposed a three-way blind spot in the release gate, now fixed and shipped as `scripts/check-profile-parity.sh`. `VG-7` (pheasant lens re-extraction) is **done and committed but NOT released** — it changes shipped `buddy` content and needs a `buddy` version bump.

Two of this session's own findings were **filed wrong and corrected the same day** — `F-4` (claimed dangling where the truth was "inert") and the `VG-7` metric. Both corrections are recorded in place rather than overwritten, because the mechanism is the reusable part. Read `W-2` before trusting any instrument in this repo.

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
*"not eval-confirmed"* rather than *"not done"*. That is `F-9`, and it is why every Next
action now states how it was verified. A third of this thread's findings are now about
reading a tracker's own field as ground truth — `F-1`, `F-4`, `F-9`, and the stale
"not yet shipped" note on `F-3`'s own Index row, corrected in the same pass.

## Next actions

> **Every item carries how it was verified and when.** An item tagged
> `[UNVERIFIED]` is a claim inherited from an earlier session, not a measurement —
> check it before executing it. This convention exists because item 4 of the first
> draft told a fresh session to add an LLM taxonomy sub-section to `security-ibex`
> that had shipped three months earlier; executing it would have produced a second
> one. See `roster-audit-session-log` `F-9`.

1. **Verify before acting — the claims, not just the tree.** `git status`,
   `./tests/run-all.sh`, `./scripts/check-profile-parity.sh` cover the *working state*,
   and they were the only things the first draft told you to check — which is why the
   stale item slipped through. **Also re-read the substrate behind any item below whose
   tag is not a measurement you can see.**
   `[verified 2026-08-26 16:48 — 16/16 suites pass; parity OK, codescout-companion 1.16.17 across 3 profiles]`

2. **A concurrent session is live in this repo.** It owns
   `docs/trackers/passover-validation-spine-2026-08-26.md`,
   `docs/trackers/reconnaissance-patterns.md` (`R-6`) and the `VG-8`/`VG-9`/`VG-10`
   entries in `validation-domain-coverage.md`. **Its two files are uncommitted, so
   `release.sh` will abort at its step-1 clean-tree pre-flight.** Do not commit them on
   its behalf and do not `git stash`. The release is gated on that session landing its
   own work.
   `[verified 2026-08-26 16:50 — mtimes 16:46:07 / 16:46:31, quiet 4 min; VG-1..VG-10 all present at 44246 bytes after my VG-6 edit, nothing clobbered]`

3. **`git push`** — `origin/main` is at `ce83dfd`; local carries `0fd8eb1` (VG-7),
   `cc4147e`, `8ed102e` and the VG-6 commit. Not yet authorised by the user.
   `[verified 2026-08-26 — git log origin/main..HEAD]`

4. **One `./scripts/release.sh buddy patch`** covering `VG-7` + `VG-6` — **not** `#21`,
   which is already released. Do not bump twice. Afterwards: refresh
   `version-bump-checklist` (`cc8cb9e23ab5cc67`) via the MCP tool, and cold-restart all
   three instances — a `resume` is not enough, it reuses the old in-memory hook.
   Blocked by item 2.
   `[verified 2026-08-26 — buddy at 0.9.1 in buddy/.claude-plugin/plugin.json; VG-7 committed in 0fd8eb1 and unreleased]`

5. **`F-1`/`F-2`** — re-open `buddy-introspection` `#20` (its "3× baseline / highest
   length" comparison is falsified: the audited ten are 118–136 lines, `codescout-pika`
   is 316) and re-scope `specialists_scanned: 10/10` to the actual 12. `T-35`'s overdue
   quarterly sweep inherits both. Two issue files already filed:
   `a4dbafccf02bc14c`, `795cb91f2bb14aaa`.
   `[verified 2026-08-26 — line counts measured directly; grep -c 'prompt-hamsa' → 0]`

6. **`F-4`** — `active-plan.md`'s `T-1..T-38` are row-only, so ~60 incoming citations are
   **inert**, not dangling. Conversion is **all-or-nothing**: the first
   `## T-N — <title>` heading makes `T` a live namespace and flips every
   not-yet-converted citation to dangling. All 38 in one commit, then `entry_prefix: T`
   + `entry_high_water_T: 38`, then `link_scan(write=true)`.
   `[verified 2026-08-26 — positive-control probe against a known-good prefix; the original "dangling" claim was filed wrong and corrected same day]`

7. **Owed — two shipped changes that no eval measures.** `VG-6`'s
   `## Properties and Invariants` section and `#21`'s LLM/AI taxonomy sub-section both
   ship unmeasured. `testing-snow-leopard-eval` scores boundary-and-observable and
   tautology-detection; `security-ibex-eval` has `idor` and `precision-clean`. Neither
   touches the new content.
   `[verified 2026-08-26 — read both prompt_tdd.yaml + all four scenario.yaml; grep for LLM in security-ibex-eval → 0 hits]`

8. **Do not promote a third reconnaissance law before `R-4` is scored.** `R-4` shipped
   into Phase 1 in 1.16.17 with its effect **unmeasured** — `buddy/tests/reconnaissance-eval`
   has cases pinned and a baseline of n=0. `R-5` (this thread) and `R-6` (the concurrent
   session) are both parked behind that baseline, deliberately. Sequence: run the
   baseline → score `R-4` → then adjudicate `R-5`/`R-6`.
   `[verified 2026-08-26 — R-4 row reads `promoted`, effect unmeasured; R-5 and R-6 both filed as held]`
## Working state

- **Branch / commit / clean-or-dirty:** `main`, local HEAD ahead of `origin/main` by the tracker commits + `0fd8eb1`. Working tree has only the items below.
- **Files changed, uncommitted:**
  - `docs/trackers/INDEX.md` — **WIP, shared.** Contains a row from a *concurrent session* (`passover-validation-spine-2026-08-26.md`) as well as mine. Committing it commits their row too.
  - `docs/trackers/passover-validation-spine-2026-08-26.md` — **KEEP, not mine.** Written by a concurrent session on the VG-9 spine-measurement thread. Left untracked deliberately; do not fold it into an unrelated commit.
- **Processes / servers that must be running:** none. codescout MCP is the only dependency.
- **Machine state:** all three profiles carry `codescout-companion 1.16.17` / `buddy 0.9.1` / `claude-statusline 1.1.7` / `session-bridge 0.1.0`, one user-scope element each; `check-profile-parity.sh` green. Six stale `installed_plugins.json.bak*` files were removed on request — no backups remain.

## Anti-goals

- **Do not measure lens-split quality with `(base + lens) / monolith`.** It is invariant under relocation — the exact fix it prescribes cannot move it (`F-8`). Use absolute lines per summon. And do not clone `VG-7`'s "addendum approaching base size" rule to `VG-1`/`VG-5` as a numeric gate: post-extraction `_llm.md` is 118 vs a 141-line base and every remaining line is legitimately LLM-specific. It is a smell, not a law.
- **Do not treat `T-N` citations as dangling.** They are inert — prefix `T` has zero definers, so `link_scan` never considers the token. `dangling_by_source` will not show them. This was filed wrong once already.
- **Do not read `link_scan`'s `ambiguous` / `dangling` arrays as a census.** Capped at 50 against populations of 70–81, with no `truncated` flag. Use `*_by_source`.
- **Do not auto-repoint every install-record element in `release.sh` step 5.** A project-scope pin may be deliberate elsewhere; `check-profile-parity.sh` deliberately detects and fails rather than rewriting.
- **Do not trust `CLAUDE.md`'s Windows section for profile state.** It is now labelled, but it asserts there is no `claude` binary and that two profiles are empty scaffolds — false here. The accurate section sits above it.
- **Do not put a second law into the reconnaissance Phase 1 bullet yet.** `R-4` shipped in 1.16.17 and is unmeasured (`buddy/tests/reconnaissance-eval` baseline n=0). `R-5` is deliberately held at `proposal` until that baseline exists.

## Open threads

- `F-5` / `F-6` — both filed as codescout issues; upstream fixes not applied. `F-6` proposes a `doctor` check, `cited_prefix_with_no_definer`.
- `F-3`'s owed regression: parse every `**Valid:**` / `**Rests on:**` line in `codescout-companion/skills/**` against the documented grammar. No MCP server needed; would have caught the 2026-08-20 regression at its own commit.
- `R-4` effect unmeasured — establishing the `reconnaissance-eval` baseline is the work it generates.
- `caveman@caveman` is still a registered marketplace in `~/.claude` and `~/.claude-kat` with nothing installed from it. Cosmetic; outside the agreed parity scope (our 4 plugins).
- `sdd` 2.4.1 is installed in no profile, and § Installing documents marketplace `claude-plugins` while everything real uses `sdd-misc-plugins`.

## Pointers

- Specs / plans / related trackers: `docs/trackers/roster-audit-session-log.md` (this session's ledger, `F-1`..`F-8`, `W-1`, `W-2`), `docs/trackers/reconnaissance-patterns.md` (`R-3`, `R-4`, `R-5`), `docs/trackers/validation-domain-coverage.md` (`VG-1`..`VG-10`), `docs/trackers/buddy-introspection.md` (`#20`, `#21`, `S-5`), `docs/trackers/active-plan.md` (`T-35`, `T-37`, `D-6`), `buddy/docs/trackers/headroom-optimization.md` (backlog 2b, re-scoped), `docs/trackers/version-bump-checklist.md` (`cc8cb9e23ab5cc67`).
- Sibling thread: `docs/trackers/passover-validation-spine-2026-08-26.md` — concurrent session, VG-9 spine measurement. Different thread; its anti-goals are its own.
- Key commits: `f53aaea` (recon SKILL fix), `448a1b8` (1.16.17 bump), `cb7d3f4` (tracker refresh), `ce83dfd` (parity check + CLAUDE.md), `0fd8eb1` (VG-7).
- Back-link: `.buddy/f6ae2d77-3ee3-46f9-ab0d-270afd61c592/` and the session transcript.
