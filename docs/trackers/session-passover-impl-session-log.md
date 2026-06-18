# Session Log — Session-Passover Implementation

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Copy this file to `docs/trackers/<topic>-session-log.md`
> in the active project on first reconnaissance pass. Append F-N / W-N
> entries via `edit_markdown(action="insert_before", heading="## Template
> for new entries", content=...)`. Add a row to the Index / Wins Index
> table for each new entry — the indexes are the eval surface, the
> sections are the evidence.
>
> **Lifecycle:**
> - Created at the start of a multi-session work stream.
> - Appended-to across every session that touches the work.
> - Entries with `Status: open` carry forward across sessions.
> - Promotion to permanent surfaces (CLAUDE.md, ADRs, formal bug
>   trackers) happens when the entry's `Promote-when` / `Fix idea`
>   criteria fire.
> - File archived (moved to `docs/trackers/archive/`) when the work
>   stream wraps.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-06-18 | med | architectural | fixed-verified | "MCPs support agent sessionId" assumption is false for codescout |
| F-2 | 2026-06-18 | low | plan-prose | mitigated | Template-placement convention contradicted the spec |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-06-18 | med | Pre-plan scout caught test-idiom + template placement before fictional tasks shipped | Plan would have specified a framework test (none exists) and a companion-dir template path fighting `docs/templates/` convention — ≥2 task rewrites at execution time | validated |

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

Codified so the Index column means the same thing across sessions.

### Friction statuses

| Status | Meaning |
|---|---|
| `open` | Observed, not yet resolved. Default for new entries. |
| `wontfix-false-alarm` | Initial observation was wrong; documented for transparency rather than deleted. |
| `mitigated` | Workaround in place; root cause not fully resolved. |
| `fixed-verified` | Code / process fix landed AND empirically confirmed. (`fixed` alone is too weak — verification is part of the status.) |
| `promoted-to-bug-tracker` | Moved to a formal tracker (`docs/issues/*`, `docs/TODO-*`, GitHub issue). The session log keeps the pointer; the formal tracker owns the lifecycle. |
| `pinned-as-eval-baseline` | Kept verbatim as a reference point for measuring later improvements. Do NOT close — its job is to remain comparable. |

### Win statuses

| Status | Meaning |
|---|---|
| `validated` | Pattern confirmed by ≥1 counterfactual data point. Default for entries with evidence. |
| `promoted-to-permanent-docs` | Moved into CLAUDE.md, an ADR, a skill, or another permanent surface. Session log keeps the pointer. |
| `archived` | Pattern no longer load-bearing — either the underlying system changed or the discipline became automatic. |

---

## F-1 — "MCPs support agent sessionId" assumption is false for codescout

**Observed:** 2026-06-18, pre-design recon for session-passover feature.

**When:** Evaluating how to thread the CC session id through the passover design.

**Expected:** codescout exposes the agent's CC session id via an MCP tool or env var (e.g. `CLAUDE_SESSION_ID`).

**Got:** No agent-facing session id from codescout — codescout's MCP-session ledger uses its own internal id with no read tool exposed. CC has no `CLAUDE_SESSION_ID` env var or slash command (both feature requests closed not-planned). The CC session id lives only on hook stdin.

**Probable cause:** Assumed MCP server capabilities mirror what hook infrastructure provides; they don't.

**Workaround:** Read the hook-written file `.codescout/cc_session_id` or `.buddy/.current_session_id`, as established by the session-start hooks that already write the id to disk.

**Severity:** med — would have built the design on a non-existent channel.

**Status:** fixed-verified — design §6 reasons from the file; §11 documents the hook-written-file approach.

**Fix idea / Pointer:** spec `docs/superpowers/specs/2026-06-18-session-passover-tracker-design.md` §6 / §11.

---

## F-2 — Template-placement convention contradicted the spec

**Observed:** 2026-06-18, pre-design recon for session-passover feature.

**When:** Locating where to place the passover tracker template as specified in §10 of the design spec.

**Expected:** Spec §10 placed the template "in codescout-companion" (i.e. somewhere under `codescout-companion/`).

**Got:** Tracker templates live in a `docs/templates/` directory — the reconnaissance skill references `<codescout-repo>/docs/templates/session-log.md` — and no such directory existed in this repo. No template lived under `codescout-companion/`.

**Probable cause:** Spec author defaulted to plugin co-location without scouting where templates actually live in either this repo or the codescout repo.

**Workaround:** Established `docs/templates/passover-template.md` in this repo; may later migrate beside the codescout repo's `session-log.md`.

**Severity:** low — placement is a convention issue, not a functional blocker.

**Status:** mitigated — `docs/templates/passover-template.md` established; spec §10 not yet updated.

**Fix idea / Pointer:** Plan Task 1.

---

## W-1 — Pre-plan scout caught test-idiom + template placement before fictional tasks shipped

**Observed:** 2026-06-18, prior to writing the session-passover implementation plan.

**Pattern:** Before writing a plan that names test assertions, paths, or template locations, scout the harness and placement conventions — specifically: (a) test discovery glob, (b) template directory, (c) any shared-library layout the plan implies.

**Counterfactual:** Without the scout, the plan would have specified a framework test (none exists — repo uses plain bash pass/fail counters) and a companion-dir template path fighting the `docs/templates/` convention. That is ≥2 task rewrites at execution time: one to rename the test file/harness invocation, one to re-establish the template in the correct location.

**Confirming data points:**
1. F-2 (this session) — template placement drift caught by reading the reconnaissance skill's reference to `docs/templates/session-log.md` before writing any tasks.
2. Bash-counter idiom discovery — `tests/run-all.sh` globs `test-*.sh` prefix pattern; a framework-style test would silently be skipped with no diagnostic output.

**Impact:** med — two potential F-Ns and associated task rewrites prevented before the plan was committed.

**Promote-when:** A second pre-plan scout catches a similar convention mismatch (test idiom, template placement, or shared-library layout). At 2 datapoints, promote to a standing rule in `superpowers/skills/writing-plans/SKILL.md` or CLAUDE.md: *"Before writing a plan that names test files, templates, or hook-library paths, scout the repo's existing conventions for each."*

**Status:** validated — single multi-finding datapoint. Awaiting promotion criterion.

---

## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
