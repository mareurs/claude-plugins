---
name: research-subagent
description: Use when the user runs /research-subagent or asks for deep research, a full report, or research where the main context should not absorb raw search results — including mapping a broad subject across multiple angles (fan-out). Spawns one or more general-purpose subagents that call the researcher MCP and return only synthesized findings. Prefer /research-web for quick inline lookups.
---

# /research-subagent — Isolated Research

Spawn a subagent that calls the researcher MCP. Main context only sees the synthesis.

**REQUIRED SUB-SKILL:** researcher-mcp — load it to pick the right tool and mode, and to use the shared research brief template.

## Mode Selection

Pick the branch right after parsing input:

- **Single** (default) — a narrow, focused question. One subagent. Use **Single Flow** below.
- **Fan-out** — a *broad subject to map* (a product, company, technology, ecosystem; verbs
  like explore / understand / overview / map / get up to speed on). Ground first, then spawn
  one subagent per distinct angle. Use **Fan-out Flow** below. Explicit phrasing ("in 5
  subagents", "from different angles", "from multiple angles") forces fan-out and, if a
  number is named, fixes the count.

When unsure, default to **Single** — fan-out costs ~N× the tokens; it is an escalation
justified only by breadth.
## When to Use

- User ran `/research-subagent [query]` or asked for a deep/report-mode search
- Main context is tight and raw research output would blow the budget
- The research output is likely multi-page (full report mode)

## When NOT to Use

- Quick lookup where inline output is fine → use `/research-web` instead
- Query is a one-liner where the MCP tool output is already compact

## Single Flow (default)

1. **Parse input.** Args → query. No args → ask.

2. **Build the research brief** (same template as `/research-web`, see `researcher-mcp`).
   - Infer Context / Prior knowledge from ambient conversation.
   - Draft "What to look for" / "What to invalidate" from project context.
   - Hard cap: 3 clarifying questions.

3. **Pick the MCP tool** using the matrix in `researcher-mcp`. Ask multiple-choice if ambiguous.

4. **Confirm the brief.** Show compact brief, ask "proceed?".

5. **Spawn a `general-purpose` subagent** via the Agent tool. Pass the subagent prompt (template below). Defaults:
   - `mode: "report"` (override if user asked for `deep`)
   - `summary_style: "toc"` — no LLM call on the server; subagent reads the full file itself
   - `max_queries` / `max_sources`: MCP defaults (uncapped)

6. **Return the subagent's synthesis to the user.** The synthesis already follows the `## Findings` format — present it as-is.

## Fan-out Flow (broad subjects)

1. **Ground first — loop until grounded.** Run a quick `WebSearch` (and `WebFetch` the
   canonical/official source if one surfaces) to learn what the subject actually IS:
   definition, category, key entities, canonical sources. Keep searching until you can name
   **concrete, non-overlapping angles**. If you can't, search again. Bound: ~3 rounds —
   after that, proceed with best-effort angles and note the thin grounding.

2. **Decompose into angles — you decide the count.** From the grounding result, enumerate
   facets (for a product, e.g.: positioning · architecture/tech · pricing/business model ·
   competitors · adoption/community/sentiment · risks). Merge or drop overlaps. Spawn the
   **fewest subagents that cover the distinct angles** — no fixed number and no hard cap, but
   more subagents = ~N× tokens and rising "context rot". If the user named a count, use it.
   Write a one-line **coverage map** (`angle → what it owns`); angles must be MECE — disjoint
   slices that together cover the subject.

3. **Show angles, then go.** Print the "what it is" line + the angle list, then proceed — no
   wait. Exception: if the user was explicit ("go", named a count), proceed silently.

4. **Spawn the angle subagents in parallel** via the Agent tool (`general-purpose`), one per
   angle, using the **Fan-out Subagent Prompt Template** below. Pass each the grounding
   summary so it skips the basics. One follow-up call per subagent — same cap as Single.

5. **Synthesize by reconciliation — not concatenation.** Merge the findings blocks:
   deduplicate overlapping facts, reconcile contradictions (weigh source authority +
   recency), flag gaps / unanswered angles. Return a unified report **organized by angle**,
   per-angle source domains preserved, with overall Confidence, Caveats, and open gaps.

**Fall back to Single** if grounding shows the subject is narrow, single-faceted, or
answerable in one search.
## Subagent Prompt Template

Pass verbatim to the subagent. Substitute the `<...>` placeholders.

```
You are a research subagent. Use only the `researcher` MCP server tools.

## Research Brief
<full brief built in step 2>

## Instructions
1. Call `<tool_name>` with the parameters below.
2. **If the response contains a `path` field (progressive envelope):** the full report is on disk — read it from `path` using a file-reading tool before synthesizing. The `toc` shows the sections; the `summary` is a navigation aid only. Do NOT synthesize from the envelope alone. If the file is unreadable, synthesize from the envelope and set Confidence to `low`.
3. Do not dump raw search results. Synthesize against the brief.
3. Apply the "What to look for" and "What to invalidate" filters
   — drop sources that fail these.
4. Answer every item in "Questions to answer". Keep searching
   (additional refined calls) until each question is covered by
   at least two independent sources or is explicitly flagged
   unanswerable in Caveats.
5. Cover all relevant angles — do not stop at the first plausible
   answer. Look for counter-evidence.
6. Reconcile contradictions: when sources disagree, surface the
   conflict, weigh source quality (authority, recency, methodology),
   and state the reconciled position OR flag as unresolved with
   both views cited.
7. Flag confidence based on source quality, consensus, and coverage.

## Tool parameters
- tool: researcher_research_run  # or mcp__researcher__<tool> in Claude Code
- mode: <mode>
- max_queries: <n or "default">
- max_sources: <n or "default">
- <tool-specific params, e.g. intent, domain_profile, aspects, framework>

## Response format — return ONLY this

## Findings: <query>
- <bullet 1 with source domain in parens>
- <bullet 2>
...

**Confidence:** high / medium / low
**Caveats:** <what couldn't be verified / gaps>
**Follow-up:** <suggested next queries, or "none">

Do not include the brief, raw search output, or meta-commentary.
```

## Fan-out Subagent Prompt Template

Pass verbatim to each angle subagent. Substitute the `<...>` placeholders.

```
You are a research subagent exploring ONE angle of a larger subject.
Use the `researcher` MCP tool (mode: report, summary_style: toc) as primary;
WebSearch / WebFetch allowed. Return ONLY the findings block — no raw dumps.

## Subject (already grounded)
<2–4 line grounding summary: what the subject is, category, canonical sources>

## Your angle
<the single angle this subagent owns>

## Boundary
Do NOT cover: <the other angles>. Those are owned by other subagents. Stay in your angle.

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
## Key Design Notes

- **One follow-up allowed.** The subagent may run one refinement call if the first search is thin. No more — cap prevents runaway spend.
- **Source domain inline.** Each bullet cites `(example.com)` so the main context can gauge credibility without loading full URLs.
- **Strict output schema.** The subagent must not leak raw search output back into the main context.

## Example Invocation

User: `/research-subagent embedding model benchmarks 2025`

You:
1. Infer context (embedding benchmarking work in this project).
2. Draft brief — What to look for: MTEB benchmarks, 2025 model releases. What to invalidate: pre-2024 comparisons.
3. Pick tool: `researcher_research_run` (pi) / `mcp__researcher__research_run` (Claude Code) with `intent: academic`, `domain_profile: academic`.
4. Confirm brief, "proceed?"
5. On confirm: spawn general-purpose agent with the template above filled in.
6. Present the subagent's `## Findings` block to the user.

## Common Mistakes

- **Including raw MCP output in the subagent response.** The whole point is isolation — enforce the strict schema.
- **Synthesizing from the envelope summary without reading the file.** The summary is a 3–5 sentence abstract. The full report is at `path` — read it.
- **Setting Confidence to `high` when the file was unreadable.** If you couldn't load the file, confidence is `low`.
- **Letting the subagent run multiple follow-up calls.** Hard cap: ONE follow-up.
- **Asking clarifying questions after the subagent returns.** Questions happen BEFORE spawning. Once the subagent is running, commit.
- **Using `/research-subagent` for trivial queries.** Subagent spawn cost is not free — route quick lookups to `/research-web`.

- **Fanning out without grounding first.** Subagents then all re-discover the basics — wasted tokens. Ground until you can name distinct angles.
- **Overlapping angles.** Vague boundaries = duplicate work. Make angles MECE; give each an explicit "do NOT cover" line.
- **Over-spawning.** More subagents ≠ better. Spawn the fewest that cover the distinct angles; fan-out is ~N× tokens.
- **Concatenating instead of reconciling.** Synthesis must dedup, resolve contradictions, and flag gaps — not staple the blocks together.
- **Fanning out a narrow query.** If one search answers it, use Single. Fan-out is an escalation for breadth.
