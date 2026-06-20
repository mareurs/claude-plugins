---
title: Fan-out mode for /research-subagent
date: 2026-06-20
status: draft
topic: research-fanout-mode
---

# Fan-out mode for `/research-subagent`

## Problem

The `research-subagent` skill spawns exactly **one** subagent against the researcher
MCP and returns its synthesis. That is right for a focused question, but it cannot
*map a broad subject*. The motivating request:

> "explore pi.dev and research about it in 5 subagents touching different angles.
> before running the subagents, first do a websearch to understand what it actually
> is so you are grounded. do the websearch until grounded."

That pattern — **ground first, then fan out into N angle-subagents, then synthesize** —
is implemented by none of the *editable* research skills:

| Skill | What it does | Subagents | Editable? |
|---|---|---|---|
| `research-web` | inline, one MCP call, lands in main context | 0 | yes (user skill) |
| `research-subagent` | one subagent → MCP → isolated synthesis | 1 | yes (user skill) |
| `researcher-mcp` | shared reference (tool matrix, brief template) | — | yes (user skill) |
| `deep-research` | generic harness: fan-out searches, adversarial verify, cited report | N (internal) | **no — compiled into the Claude Code binary** |

The fan-out pattern sits between `research-subagent` (1 subagent, no grounding) and the
built-in `deep-research` (generic, not editable, not MCP-aware). We add it as a **second
branch inside `research-subagent`** rather than a new skill, keeping the `/research-*`
surface stable.

## Goals

- Add a **fan-out branch** to `research-subagent` for broad subjects.
- Ground before spawning; derive angles from grounding; spawn N parallel subagents;
  synthesize by reconciliation.
- Right-size N to subject breadth — **the model decides the count**, no fixed number.
- Preserve the skill's core identity: main context sees synthesis, not raw search.

## Non-goals

- No change to `research-web` (inline path stays as-is).
- No new top-level skill / slash command.
- No replacement of the built-in `deep-research` harness.
- No hard numeric cap on subagent count (guidance-based right-sizing instead).

## Research grounding

Design choices below are grounded in Anthropic's multi-agent research engineering blog
and the OpenAI / Google deep-research docs (researched 2026-06-20):

- **Orchestrator-worker** with isolated context windows + structured returns is the
  production pattern; up to **90.2%** improvement over single-agent on breadth-first
  research — at **~15× the token cost**. Over-spawning is the cardinal failure
  (redundant search + "context rot"). *(anthropic.com/engineering)*
- **Scale subagent count to breadth, not a constant.** Anthropic prescribes no fixed
  number — effort is complexity-scaled. Validates "let the model decide N."
- **Ground / scope before fan-out** is a named best practice — stops every subagent
  re-discovering the basics and inheriting hallucinations.
- **Each subagent brief needs four axes**: (1) one objective + explicit boundary
  ("do NOT cover X, Y"), (2) fixed output format, (3) tools/sources, (4) scope. Vague
  briefs are the #1 cause of duplicate work.
- **OpenAI / Gemini** front-load a plan + (optional) clarify step before executing —
  validates the "show angles, then go" gate.
- Synthesis must **reconcile** (dedup, resolve contradictions, flag gaps), not concatenate.

## Design

The skill gains a branch selected right after input parsing.

### 1. Activation — auto-detect breadth

Classify the request:

- **Broad subject to *map*** (a product / company / technology / ecosystem; verbs like
  *explore, understand, overview, map, get up to speed on*) → **fan-out branch**.
- **Narrow factual question** → existing **single-subagent branch** (unchanged).

Explicit phrasing ("in 5 subagents", "from different angles", "from multiple angles")
is a stronger fan-out signal and also fixes the count if a number is named.

### 2. Ground-first — and gate the fan-out on it

The orchestrator runs a quick `WebSearch` (and `WebFetch` of the canonical/official
source if one surfaces) to establish *what the subject actually is*: definition,
category, key entities, canonical sources.

**Loop until grounded** = loop until the orchestrator can name **concrete, non-overlapping
angles**. If it cannot articulate distinct angles, search again. Bounded to **~3 rounds**
so it cannot spin forever; after the bound, proceed with best-effort angles and note the
thin grounding.

Grounding output: a 2–4 line "what it is" + a candidate angle list.

### 3. Decompose into angles — model decides the count

Enumerate facets from the grounding result. Example facets for a product:
positioning · architecture/tech · pricing/business model · competitors/alternatives ·
adoption/community/sentiment · risks/limitations.

- Merge or drop overlapping facets.
- **The model chooses how many angles to run** from observed breadth — spawn the
  **fewest that cover the distinct angles**. The skill states the anti-pattern explicitly:
  more subagents = ~15× tokens and rising context-rot risk. **No hard cap.**
- Write a one-line **coverage map** (`angle → what it owns`) before dispatch so overlap
  is caught at design time. Angles must be **MECE**: each owns a disjoint slice; together
  they cover the subject.

### 4. Confirm gate — show angles, then go

After grounding, briefly show the "what it is" line + the proposed angle list, **then
proceed without waiting**. Exception: if the user was explicit ("go", named a count),
proceed silently. (No always-wait round-trip; cheap scope insurance for the auto-triggered
case.)

### 5. Dispatch N parallel subagents — four-axis brief

Via the Agent tool, **in parallel**, each `general-purpose` subagent receives:

1. **Objective + boundary** — its one angle, plus an explicit
   *"do NOT cover X, Y — owned by other angles"* line.
2. **Output format** — the existing `## Findings` schema (bullets with source domains +
   `Confidence` + `Caveats`).
3. **Tools/sources** — researcher MCP (`mode: report`, `summary_style: toc`) as primary;
   `WebSearch` / `WebFetch` allowed. **The grounding summary is passed in** so the subagent
   skips the basics.
4. **Scope/depth** — angle-appropriate depth.

The existing **one-follow-up cap per subagent** carries over.

### 6. Synthesize + reconcile

The orchestrator merges the N findings blocks — **not** concatenation:

- Deduplicate overlapping facts.
- Reconcile contradictions (weigh source authority + recency).
- Flag gaps / unanswered angles.

Returns a unified report **organized by angle**, per-angle source domains preserved, with
an overall `Confidence`, `Caveats`, and open gaps.

### 7. When NOT to fan out

If grounding reveals the subject is narrow, single-faceted, or answerable in one search →
**fall back to the single-subagent branch** (or inline). Single is the default; fan-out is
the escalation, justified only by breadth.

## Subagent prompt template (fan-out)

Added alongside the existing single-subagent template. Each angle-subagent gets a filled
copy:

```
You are a research subagent exploring ONE angle of a larger subject.
Use the `researcher` MCP tool (mode: report, summary_style: toc) as primary;
WebSearch / WebFetch allowed. Return ONLY the findings block — no raw dumps.

## Subject (already grounded)
<2–4 line grounding summary: what the subject is, category, canonical sources>

## Your angle
<the single angle this subagent owns>

## Boundary
Do NOT cover: <other angles>. Those are owned by other subagents. Stay inside your angle.

## Instructions
1. Research your angle only. Do not re-establish the basics — they are in "Subject" above.
2. If a researcher-MCP response has a `path` field, read that file before synthesizing.
3. One refinement call allowed if the first pass is thin. No more.
4. Cite source domains inline. Flag confidence by source quality + consensus.

## Response format — return ONLY this
## Findings: <angle>
- <bullet with source domain in parens>
...
**Confidence:** high / medium / low
**Caveats:** <gaps / unverified>
```

## Implementation notes

- **Edit target:** `~/.claude*/skills/research-subagent/SKILL.md`.
- **Mirror across all three profiles** (global CLAUDE.md rule): write the identical file to
  `~/.claude/skills/`, `~/.claude-sdd/skills/`, and `~/.claude-kat/skills/`. Verify the
  three copies are byte-identical after editing.
- Keep the existing single-subagent flow intact; the fan-out branch is additive.
- `researcher-mcp` (shared reference) needs no change — the fan-out brief reuses its tool
  matrix and the existing `## Findings` schema. Add at most a one-line pointer if needed.

## Verification

- **Narrow query** (e.g. "what changed in Axum 0.8") → still takes the single-subagent
  branch, no grounding loop, no fan-out.
- **Broad subject** (e.g. "explore pi.dev") → grounds first, prints "what it is" + angle
  list, spawns N parallel subagents, returns an angle-organized synthesis.
- **Explicit count** ("explore pi.dev in 5 subagents") → N fixed to 5, proceeds silently.
- **Three-profile parity:** `diff` the SKILL.md across the three skill dirs → identical.

## Open questions

None blocking. The grounding-loop bound (~3 rounds) and the facet starter-list are
guidance, tunable after first real use.
