---
name: reconnaissance
description: Use before subagent dispatch, before structural edits that depend on struct/API shapes, after ANY surprise from the plan or expectations, and at the start of multi-task work. Externalizes drift findings to a session-log tracker (F-N/W-N entries) so the discipline compounds across sessions.
---

# /codescout-companion:reconnaissance

Scout the seam before you act. When you find drift between plan and reality,
externalize it as a session-log entry so the next session inherits the lesson.

**REQUIRED SUB-SKILL:** None. Self-contained but composes with
`subagent-driven-development`, `writing-plans`, and `verification-before-completion`.

## When to Use

- **Before delegating to a subagent.** Scout the seam yourself first — read the
  affected symbols, confirm the plan's code matches reality. Subagents inherit
  drift; the controller absorbs it.
- **Before editing code whose shape you have not verified.** If the change names
  a struct, function, or API you haven't read this session, read it before editing.
- **After a tool response disagrees with the plan.** Empty results when the plan
  predicted N entries, compile errors on plan code, a wrong status field — these
  are signals that the plan is stale or the substrate has moved.
- **When the controller has just discovered the plan code is fictional.** Inline
  reconnaissance beats re-dispatching a subagent with the same wrong plan.

## When NOT to Use

- **Read-only Q&A.** "What does X do?" — answer via `symbols(name=..., include_body=true)`,
  not via reconnaissance ceremony.
- **Trivial mechanical edits.** Version bumps, formatting, doc-only changes — no
  shape dependency, no plan drift surface.
- **The session is already in verification phase.** Use
  `verification-before-completion` for completion claims; reconnaissance is for
  drift detection, not commit gating.
- **Already scouted this seam in the current session.** Reconnaissance
  externalizes findings; once externalized, don't re-scout the same shape unless
  the source has changed.
- **Underspecified refactor prompts** (`"refactor X for readability"` with no
  shape contact named). Ask the user whether shape changes; do not run
  reconnaissance speculatively.

## Flow

```
1. Scout the seam
   ↓
2. Compare reality to plan / expectations
   ↓
3. If gap found    → externalize as F-N entry
   If practice won → externalize as W-N entry
   ↓
4. Resume original task with verified context
```

### Phase 1 — Scout

For the symbol, file, or contract about to be touched:

- Read the symbol: `symbols(name=..., include_body=true)`
- Read the callers if shape changes: `references(symbol, ...)` or
  `call_graph(symbol, direction="callers")`
- For tools / APIs: read the tool's actual response shape, not the doc's
  described shape.

### Phase 2 — Compare

State what the plan / expectation said vs. what reality holds. Two outcomes:

- **Match** → scout passed; resume task. No entry needed.
- **Gap** → continue to Phase 3.

### Phase 3 — Externalize

Findings go into a session-log tracker file in the active project. If one does
not exist yet, copy `docs/templates/session-log.md` (in the codescout repo) to
`docs/trackers/<topic>-session-log.md` in the active project and append.

**F-N entries (frictions — drift, surprises, costs):**

```markdown
### F-N — <one-line title>
**When:** <session task you were doing>
**Expected:** <what plan / docs / prior session said>
**Got:** <actual observed reality>
**Probable cause:** <one sentence>
**Workaround:** <what you did to proceed>
**Severity:** low | med | high
**Status:** open | wontfix-false-alarm | fixed-verified | promoted-to-bug-tracker
```

**W-N entries (wins — patterns that prevented worse):**

```markdown
### W-N — <one-line title>
**When:** <session task>
**Pattern:** <the practice that worked>
**Counterfactual:** <what would have happened without it>
**Confirming data points:** <N session moments that validate this>
**Impact:** low | med | high
**Promote-when:** <criterion for graduation into permanent docs>
```

Always allocate the next ID (`F-10`, `W-6`, etc.). Entries without IDs cannot
be cited in commits or future sessions and do not compound.

### Phase 4 — Resume

With verified context, return to the original task. Cite the F-N / W-N entry
by ID in the next subagent dispatch or commit message — IDs persist; the
lesson compounds across sessions.

## Stop Condition

Reconnaissance is done when **any one** of:

- The shape question has a one-line answer cited from the code.
- The plan-vs-reality gap is captured as an F-N entry.
- The decision is made to revise the plan rather than the code.

Do NOT loop reconnaissance — one pass per seam per session. If the same seam
needs scouting again later in the session, the substrate has moved; capture
that as a separate F-N entry rather than re-running this flow.

## Common Mistakes

- **Scouting after dispatching.** The subagent has already started; drift in
  the plan now lives in two contexts. Scout BEFORE dispatch.
- **Externalizing without an ID.** Entries without F-N / W-N IDs can't be cited
  in commits and don't compound. Always allocate the next ID.
- **Skipping the counterfactual on W-N.** A win without a counterfactual reads
  as marketing. Name what would have happened without the pattern, with
  evidence.
- **Treating reconnaissance as verification.** Verification is at completion;
  reconnaissance is at the seam. Different skills, different timing.
- **Re-scouting the same seam twice.** If the shape didn't change, re-reading
  is noise. If it did change, that's a new F-N entry.

## Composition with other skills

| Trigger | Skill | Reconnaissance role |
|---|---|---|
| Plan dispatched to subagent | `subagent-driven-development` | Scout the seam BEFORE dispatch |
| Plan code looks fictional | (inline execution) | Externalize as F-N, fix plan inline |
| Tool returned unexpected output | `systematic-debugging` | Capture as F-N, then debug |
| About to claim work complete | `verification-before-completion` | Different skill — reconnaissance is at the seam, not at completion |

## Eval

Trigger string is scored against `docs/evals/reconnaissance-trigger.md` in the
codescout repo. Empirical baseline (2026-05-17): 6/7 with this description.
Re-score before any future description change.
