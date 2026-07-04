# Session Log — Research Skills Refactor

> **Purpose:** Two-sided observation log for the research-skills dialect
> refactor (fix the fictional researcher MCP API across all surfaces,
> Hamsa restructure, portable-slice prompt-tdd eval). Plan:
> `~/.claude-sdd/plans/zany-soaring-key.md`. Captures frictions (F-N) and
> wins (W-N) so future sessions inherit the lesson.
>
> **How to use:** Append F-N / W-N entries via
> `edit_markdown(action="insert_before", heading="## Template for new
> entries", content=...)`. Add a row to the Index / Wins Index table for
> each new entry — the indexes are the eval surface, the sections are the
> evidence.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-07-04 | low | plan-prose | mitigated | pi extension MCP health-indicator references non-existent `researcher_research_run` |
| F-2 | 2026-07-04 | med | architectural | fixed-verified | research-subagent portable-slice eval blocked by L-7 (MCP-coupled + sub-skill not auto-loaded) |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| _(none yet)_ | | | | | |

---

## Category conventions

Use a short kebab-case category to group similar frictions. Prior
sessions have used:

| Category | When to use |
|---|---|
| `codescout-tool` | Friction in a codescout MCP tool (`grep`, `read_file`, `edit_markdown`, etc.) |
| `subagent` | Subagent produced unexpected output or diverged from instructions |
| `plan-prose` | Plan document had drift vs reality (wrong file paths, fictional code, mismatched counts) |
| `architectural` | Discovered structural property of the system that the plan / docs didn't surface |
| `self-friction` | Predicted a friction that turned out to be a false alarm — recorded for transparency |
| `<language>-<library>` | Language- / library-specific footgun (`rust-serde`, `python-typing`) |
| `release-pipeline` | Deployment-time gap (release binary missing, MCP reload needed, etc.) |

Add a new category by writing it as a kebab-case string; no central registry needed.

---

## F-N entry template

Copy this block when appending a new friction. Allocate the next free
ID. Add a matching row to the Index table.

```markdown
## F-N — <one-line title>

**Observed:** <date, session task>

**When:** <what you were trying to do>

**Expected:** <what plan / docs / prior session said>

**Got:** <actual observed reality>

**Probable cause:** <one sentence>

**Workaround:** <what you did to proceed>

**Severity:** low | med | high

**Status:** open | wontfix-false-alarm | fixed-verified | mitigated | promoted-to-bug-tracker | pinned-as-eval-baseline

**Fix idea / Pointer:** <issue # in formal tracker, plan task ID, or "TBD">

---
```

## W-N entry template

Copy this block when appending a new win. A win without a
**Counterfactual** is marketing — name what would have happened
without the pattern, with at least one piece of evidence.

```markdown
## W-N — <one-line title>

**Observed:** <date, session task>

**Pattern:** <the practice that worked>

**Counterfactual:** <what would have happened without the pattern, with evidence>

**Confirming data points:** <list of session moments validating the pattern; aim for ≥2>

**Impact:** low | med | high

**Promote-when:** <criterion for graduating into permanent docs (CLAUDE.md, ADR, etc.)>

**Status:** validated | promoted-to-permanent-docs | archived

---
```

---

## Status vocabulary

### Friction statuses

| Status | Meaning |
|---|---|
| `open` | Observed, not yet resolved. Default for new entries. |
| `wontfix-false-alarm` | Initial observation was wrong; documented for transparency rather than deleted. |
| `mitigated` | Workaround in place; root cause not fully resolved. |
| `fixed-verified` | Code / process fix landed AND empirically confirmed. |
| `promoted-to-bug-tracker` | Moved to a formal tracker. The session log keeps the pointer. |
| `pinned-as-eval-baseline` | Kept verbatim as a reference point for measuring later improvements. |

### Win statuses

| Status | Meaning |
|---|---|
| `validated` | Pattern confirmed by ≥1 counterfactual data point. |
| `promoted-to-permanent-docs` | Moved into CLAUDE.md, an ADR, a skill, or another permanent surface. |
| `archived` | Pattern no longer load-bearing. |

---

## F-1 — pi extension MCP health-indicator references non-existent `researcher_research_run`

**Observed:** 2026-07-04, pre-implementation reconnaissance for the research-skills dialect refactor (plan `zany-soaring-key`). Scouting the full blast radius of the `research_run` fiction before editing.

**When:** After approving a plan whose Part A fix-set named three files (the `researcher-mcp`, `research-subagent`, `research-web` SKILL.md prompt surfaces). Grepping the whole `claude-plugins` workspace for the fictional tool name — not just `skills/`.

**Expected (plan):** The `research_run` fiction lives only in the three research SKILL.md prompt surfaces.

**Got (scouted reality):** It is also hardcoded in runtime code — `pi/extensions/codescout-companion.ts:33`: `{ name: "researcher", indicatorTool: "researcher_research_run" }`. pi's MCP-connectivity line checks `pi.getAllTools()` for `indicatorTool`; pi names MCP tools `<server>_<tool>` (confirmed by the sibling `codescout_grep` indicator on line 32). The researcher server's entry tool is `research` (verified: `researcher/src/mcp_server.rs` + `config.rs:46 name="research"`; **no `research_run` exists**), so pi exposes `researcher_research`. `researcher_research_run` is never in the tool set → the pi statusline renders `researcher ●` as disconnected even when the server is live.

**Probable cause:** The whole research feature (3 skills + pi extension) was authored in one commit (`a4af374 feat(pi): add pi companion`) against an imagined consolidated `research_run` API; the plan's blast-radius analysis scoped to `skills/` and missed the `.ts` runtime surface.

**Workaround:** Add the pi surfaces to the fix-set (3 files → 4): fixed `pi/extensions/codescout-companion.ts:33` (`researcher_research_run` → `researcher_research`) and the two `pi/README.md` mirrors (the `MCP_SERVERS` indicator snippet + the researcher `directTools` config example, which listed `research_run`). **Caveat:** the *exact* correct pi indicator string depends on pi's `directTools`↔prefix interaction (a tool listed in `directTools` surfaces bare, otherwise `<server>_<tool>`), which was NOT verified against pi's (external) source. This removes the `research_run` fiction and follows the `codescout_grep` prefixed-indicator precedent, but the statusline dot's runtime correctness is unverified.

**Severity:** low — cosmetic (pi statusline MCP-health indicator only; does not break research). But would have shipped unfixed, leaving the fiction half-corrected: the skills would name the real tools while the health check still probed the fictional one.

**Status:** mitigated — `research_run` fiction removed across all 4 surfaces; pi-runtime correctness of the health-indicator dot unverified (external repo).

**Fix idea / Pointer:** Plan `zany-soaring-key` Part A; add the pi extension to the propagation set.

---

## F-2 — research-subagent portable-slice eval blocked by L-7 (MCP-coupled + sub-skill not auto-loaded)

**Observed:** 2026-07-04, Part C of the research-skills refactor — building the "portable-slice eval with teeth" the user approved.

**When:** Running S1 (brief-template anchors) + S3 (tool-selection dialect: `contains research_code` / `not_contains research_run`) via prompt-tdd against the `~/.prompt-tdd/profiles/plugin-free` profile (sonnet, `--strict-mcp-config`).

**Expected (plan):** The portable slice — brief construction + tool-selection naming — would be isolation-evaluable with a real `--ablate` control (plan Part C).

**Got:** Both scenarios RED on the POSITIVE arm (n=2), *before* `--ablate` is even relevant. S1: the model produced a competent brief but with its own headings ("Scope to cover", "Sources to prioritize"), not researcher-mcp's template — `What to invalidate` / `Coverage & reconciliation` absent. S3: asked to name the exact tool, the model wrote `Skill(skill="deep-research", …)` — a *different* research skill — not `research_code`.

**Probable cause:** L-7 (MCP-coupled competence skill), **doubled**. (1) The tool dialect (`research_code`) needs the researcher MCP present, but the isolation profile strips it (`--strict-mcp-config`), so the model can't name a tool it doesn't have and substitutes a research skill it knows (`deep-research`). (2) The tool-matrix + brief template live in the `researcher-mcp` REQUIRED SUB-SKILL, which the model does not auto-load in a fresh single-turn — so neither applies and a base-competent brief fills the gap. Predicted in the plan; confirmed empirically.

**Workaround:** Scenarios removed + `prompt_tdd.yaml` registration reverted (no red/green theatre). Dialect fix (Part A) verified statically (`grep` for `research_run`/`target=`/`summary_style` → 0 hits across the 3 skills) and rerouted to a LIVE acceptance run (real researcher MCP) for runtime confirmation. Full write-up: prompt-engineering `docs/trackers/skill-eval-log.md` § research-subagent.

**Sub-finding (real-env check):** researcher-mcp not auto-loading means the tool-matrix + brief template may under-apply even in production unless the researcher MCP's *presence* pulls the model toward the right tools — worth a live check.

**Severity:** med — the approved deliverable (measured teeth) is unattainable in isolation, so the fix's runtime correctness stays UNVERIFIED until a live-acceptance / MCP-present harness runs. Not high: static verification is solid and L-7 was flagged upfront.

**Status:** mitigated — documented + rerouted to live-acceptance verification; a researcher-MCP-present harness is the open path to real teeth.

**Fix idea / Pointer:** live `/research-subagent` acceptance run with the researcher MCP configured; or a researcher-MCP-present eval profile. skill-eval-log § research-subagent.

**Update (2026-07-04, later — ran it end-to-end):** (1) **Live acceptance PASSED** — a subagent with the corrected template called `mcp__researcher__research_code` cleanly and returned a real axum-0.8 `## Findings` block; **dialect now RUNTIME-verified**, not just static. (2) **Correction to this entry's L-7 verdict:** only the *full dispatch/execution* loop is L-7-blocked — the *tool-selection dialect* (yields `research_code`, never `research_run`) IS isolation-evaluable via an MCP-independent **decision-eval** (`scenarios/skills/researcher-tool-dialect` in prompt-engineering; base model can't know the compound tool names → `--ablate` should go RED). (3) The gate is **built but unvalidated (N=0)**: its one run hit an account `rate_limit_error` (many concurrent `claude -p` prompt-tdd sessions saturating the shared account), not a skill signal — re-run in a quiet window. (4) **Harness gap:** `ScenarioSetup` has no MCP field + adapter forces `--strict-mcp-config` with no `--mcp-config`, so an isolated profile can't present the researcher MCP; a full-flow MCP-coupled test needs a harness extension.

**Result (2026-07-04, quiet window — gate VALIDATED):** a background poller waited for the account rate-limit contention to clear (no competing `claude -p`), then ran `researcher-tool-dialect`: positive **1/1 PASS** (5.4s; `research_code`/`research_person`/`market_insight` present, `research_run` absent), `--ablate` **RED — power confirmed**. Non-tautological gate **shipped** in prompt-engineering. The tool-selection *dialect* is thus isolation-evaluable with teeth; only the full dispatch loop stays L-7-blocked (covered by the one-off live acceptance run). Status → fixed-verified.

---
## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
