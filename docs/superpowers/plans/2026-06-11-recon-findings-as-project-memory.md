---
status: draft
kind: plan
opened: 2026-06-11
owner: marius
related:
  - "[design spec](../specs/2026-06-11-recon-findings-as-project-memory-design.md)"
---

# Reconnaissance Findings as Project Memory — Implementation Plan

**Spec:** [`2026-06-11-recon-findings-as-project-memory-design.md`](../specs/2026-06-11-recon-findings-as-project-memory-design.md).
Read it first — this plan executes that decision, it does not re-derive it.

The design is light: a promotion-routing change in the recon `SKILL.md`, one behavioral-
eval case, a doc-drift fix, and a confirm-no-code-change check. **No companion logic
changes** — the SessionStart hook already advertises any `.codescout/memories/*.md` topic
by glob (`scripts/detect.py:175-179`), confirmed in the scout that closed the spec's open
questions.

**Cross-repo.** Tasks touch two repos:
- `claude-plugins` (this repo): the recon `SKILL.md`, `CLAUDE.md`, `detect.py` test, the bump.
- `codescout` (sibling): the behavioral eval `docs/evals/reconnaissance-output.md`.

**Seam — Hamsa owns Task 1's wording.** The *shape* (route project-shaped lessons to a
memory topic) is the Snow Lion's; the *exact rule format and cap wording* is the Prompt
Hamsa's craft. Task 1 authors the mechanism; dispatch the rule-format prose to the Hamsa
(or `/buddy:summon hamsa`) for the final wording.

## Pre-flight

- [ ] **Step 1: Confirm the spec is firm.** Open the spec; verify `## Open questions` shows
  #1/#2/#4 closed (they were, by the 2026-06-11 codescout scout). If any reopened, stop and
  re-scout before implementing.

- [ ] **Step 2: Working tree clean for the files this plan touches.**
  ```bash
  git status --short codescout-companion/skills/reconnaissance/SKILL.md CLAUDE.md
  ```
  The `SKILL.md` already carries the uncommitted Skill-maintenance pointer edit from the
  Hamsa audit + the queued bump. That edit is **compatible** — Task 1 adds to a different
  section. Leave it; Task 6 (bump) commits both together.

---

## Task 1: Promotion-routing — project-shaped lessons → `reconnaissance` memory topic

**Repo:** `claude-plugins`.
**Files:**
- Edit: `codescout-companion/skills/reconnaissance/SKILL.md`

The recon skill's `promote-when` clauses today target `SKILL.md` / `CLAUDE.md` (global).
Add a routing decision and a second, *project-local* promotion target.

- [ ] **Step 1: Add the routing test.** In the `## The recon-patterns tracker (per project)`
  section (which already argues "why per project, not global"), add the explicit routing
  rule:
  - **Craft-shaped** (true in any repo: a language/tool/protocol pattern) → promote to
    `SKILL.md`, as today.
  - **Project-shaped** (this repo's dialect, build quirks, gotchas) → write a distilled rule
    to the project's codescout memory: `memory(action="write", topic="reconnaissance",
    content=<rule>)`. Routing test: *"would this rule mislead a different project?"* Yes →
    project memory; No → `SKILL.md`.

- [ ] **Step 2: Pin the memory-rule format + cap (Hamsa's wording).** A `reconnaissance`
  memory entry is one **concrete, bounded** behavioral rule + a one-line `R-N`/`F-N` pointer
  to its ledger origin — never prose (Constraint 4 / Risk 2). Target cap ≈ 10 rules; when
  exceeded, consolidate or demote the weakest back to tracker-only. **Dispatch this step's
  exact wording to the Prompt Hamsa** — concrete-rule phrasing is its craft, not the
  Snow Lion's.

- [ ] **Step 3: State the ungated-channel discipline.** One line: promotion writes to the
  `reconnaissance` topic happen *only* through this skill's promote-when path. The channel
  is ungated (any agent can write it — Risk 5); the bar is a norm, so the skill must own it.

- [ ] **Step 4: Verify.** `read_markdown` the changed section's heading map; confirm the
  routing rule names both targets, the `memory(write…)` call, the format, and the cap. No
  edit to Phases 1–2 (scout method unchanged).

**Done when:** the skill instructs an agent, at promotion time, to classify craft-vs-project
and route project-shaped lessons to the memory topic with a bounded rule.

---

## Task 2: Behavioral-eval case — is the advertised topic read + applied?

**Repo:** `codescout` (sibling).
**Files:**
- Edit: `docs/evals/reconnaissance-output.md`

This is the instrument for Risk 1 (the load-bearing unknown: does advertise-pull get read?).

- [ ] **Step 1: Add a case** (next case number) under `## Cases`: a project has a
  `reconnaissance` memory topic advertised at SessionStart (in `CS_MEMORY_NAMES`) holding a
  recorded rule whose drift is live in code. **Scenario:** a task that the rule would catch.
  **Planted drift:** the rule is in the memory topic, *not* in the SKILL.md or any reachable
  doc. **Expected:** the agent calls `memory(action="read", topic="reconnaissance")` (or is
  prompted by the advertisement to), then applies the rule before acting. **PASS:** reads +
  applies. **FAIL:** ignores the advertised topic and repeats the mistake.

- [ ] **Step 2: Update Status + Re-evaluation pointers** noting the new case measures the
  advertise-pull efficacy the design's Risk 1 flags.

- [ ] **Step 3: Verify.** `read_markdown` the Cases heading map; the new case renders with
  Scenario / Planted drift / Expected / PASS-FAIL boundary, matching the others.

**Done when:** the eval can answer "does an advertised memory rule change behavior?" — the
gate before the design is trusted. (Running it is a separate act, like the existing baseline.)

---

## Task 3: Fix the stale `CLAUDE.md` doc-drift (Risk 4)

**Repo:** `claude-plugins`.
**Files:**
- Edit: `CLAUDE.md`

- [ ] **Step 1: Correct the claim.** `CLAUDE.md` says the companion "injects
  `.codescout/system-prompt.md` content verbatim." The hook injects a *pointer*
  (`memory(read, topic="system-prompt")`) per the injection-budget redesign. Reword to:
  "injects a pointer to `.codescout/system-prompt.md` (read via `memory(read,
  topic='system-prompt')`) — pointers, not verbatim content (injection-budget redesign)."

- [ ] **Step 2: Verify.**
  ```bash
  grep -n 'verbatim' CLAUDE.md
  ```
  Expected: no remaining claim that system-prompt content is injected verbatim.

**Done when:** `CLAUDE.md` matches `session-start.sh` reality.

---

## Task 4: Confirm no companion code change (and pin it with a test)

**Repo:** `claude-plugins`.
**Files:**
- Possibly edit: `codescout-companion/tests/test_detect.py` (or the shell detect test)

- [ ] **Step 1: Confirm the glob.** Re-read `scripts/detect.py:173-179` — `memory_names`
  is built by iterating `<project>/.codescout/memories/*.md` stems. A new
  `reconnaissance.md` surfaces automatically. **No `detect.py` change.**

- [ ] **Step 2: Pin it.** Check `test_detect.py` for a case asserting that a `memories/*.md`
  file appears in `CS_MEMORY_NAMES`. If absent, add one: fixture project with
  `.codescout/memories/reconnaissance.md` → assert `reconnaissance` ∈ `CS_MEMORY_NAMES`.

- [ ] **Step 3: Verify.**
  ```bash
  python3 -m pytest codescout-companion/tests/test_detect.py -q
  ```
  Expected: green, including the new enumeration assertion.

**Done when:** a test proves a new memory topic auto-advertises — so future hook edits can't
silently break the channel this design rides.

---

## Task 5 (optional — gated on Task 2's result): read-probability boost

**Do NOT do this preemptively.** Only if the eval (Task 2, once run) shows agents skip the
advertised `reconnaissance` topic.

**Repo:** `claude-plugins`.
**Files:**
- Edit: `codescout-companion/hooks/session-start.sh` (the `SKILLS AVAILABLE` block)
- Edit: the session-start payload test

- [ ] Add a one-line explicit pointer beside the existing system-prompt pointer:
  *"Recon lessons for this project — `memory(action='read', topic='reconnaissance')`."*
  Stays within the injection budget (one line). Extend the payload test to assert it.

**Done when:** measured under-read is mitigated — or skip entirely if the bare advertisement
suffices.

---

## Task 6: Version bump — `codescout-companion`

**Repo:** `claude-plugins`. Follows `CLAUDE.md` § Version Management.

- [ ] **Step 1:** Tasks 1, 3, (4) are committed and tests green (`./tests/run-all.sh`,
  `test_detect.py`). This bump folds the already-queued Skill-maintenance pointer edit + the
  Task 1 routing change.
- [ ] **Step 2:** Bump `codescout-companion/.claude-plugin/plugin.json`, update the README
  version table, `scripts/check-versions.sh`.
- [ ] **Step 3:** `scripts/bump-cache.sh codescout-companion <version>`; update `installPath`
  + `version` in all three profiles' `installed_plugins.json`; refresh the version-bump-
  checklist tracker (`commit_refresh=true`) and confirm every row ✅.
- [ ] **Step 4:** Commit; **push** (the SKILL.md change ships only on push + cold-restart).
- [ ] **Step 5:** Cold-restart all three CC instances (a resume reuses the old hook).

**Done when:** the routing-capable recon skill is live in all three profiles.

---

## Done

- [ ] Task 1 — promotion routing in the recon SKILL.md (Hamsa wording landed)
- [ ] Task 2 — eval case added (codescout repo)
- [ ] Task 3 — CLAUDE.md doc-drift fixed
- [ ] Task 4 — detect.py enumeration pinned by a test
- [ ] Task 5 — only if the eval demanded it
- [ ] Task 6 — codescout-companion bumped, pushed, cold-restarted
- [ ] The first real project-shaped promotion writes the inaugural `reconnaissance`
      memory entry — runtime, not a build step; the mechanism activates on next promote-when.
