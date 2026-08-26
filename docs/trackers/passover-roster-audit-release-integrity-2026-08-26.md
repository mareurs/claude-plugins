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

## Next actions

1. Read this doc, then **VERIFY** the working state below still holds (`git status`, `./tests/run-all.sh`, `./scripts/check-profile-parity.sh`) BEFORE acting — the handoff may be stale.
2. **`git push`** — `0fd8eb1` (VG-7) and the tracker commits are local; `origin/main` is at `ce83dfd`.
3. **`VG-6`** — add a property/invariant section to `testing-snow-leopard`. Content is drafted in `validation-domain-coverage.md` § Domain block D, first paragraph. Cheapest of the open VG items: a section, not a specialist.
4. **`#21`** — add an LLM/AI taxonomy sub-section to `security-ibex` (prompt injection LLM01, insecure output handling LLM02, training-data poisoning LLM03). `buddy-introspection` `#21` has the fix already written.
5. **Then one `./scripts/release.sh buddy patch`** covering `VG-7` + `VG-6` + `#21` — do not bump three times. Afterwards: refresh `version-bump-checklist` (`cc8cb9e23ab5cc67`) via the MCP tool, and cold-restart all three instances (a `resume` is not enough).
6. **`F-1`/`F-2`** — re-open `buddy-introspection` `#20` (its "3× baseline / highest length" comparison is falsified: audited ten are 118–136 lines, `codescout-pika` is 316) and re-scope `specialists_scanned: 10/10` to the actual 12. `T-35`'s overdue quarterly sweep inherits both.
7. **`F-4`** — `active-plan.md`'s `T-1..T-38` are row-only, so ~60 incoming citations are **inert** (not dangling — see the correction). Conversion is **all-or-nothing**: the first `## T-N — <title>` heading makes `T` a live namespace and flips every not-yet-converted citation to dangling. All 38 in one commit, then `entry_prefix: T` + `entry_high_water_T: 38`, then `link_scan(write=true)`.

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

