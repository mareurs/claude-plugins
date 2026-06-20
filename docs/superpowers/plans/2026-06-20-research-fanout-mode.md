# Fan-out Mode for /research-subagent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "fan-out" branch to the `research-subagent` skill that grounds a broad subject with web search, decomposes it into MECE angles, spawns one subagent per angle in parallel, and synthesizes by reconciliation.

**Architecture:** Additive edit to a single markdown skill file. The existing single-subagent flow is preserved and renamed for clarity; a new mode-selection block routes broad subjects to a new fan-out flow + prompt template. The edited file is mirrored byte-identical across all three Claude Code profiles.

**Tech Stack:** Markdown skill file (`SKILL.md`). No code. Verification via `grep` / `diff` / read-back.

## Global Constraints

- **Edit target:** `<profile>/skills/research-subagent/SKILL.md` where `<profile>` ∈ `~/.claude`, `~/.claude-sdd`, `~/.claude-kat`.
- **Three-profile parity (global CLAUDE.md rule):** the final `SKILL.md` MUST be byte-identical across all three profiles. Canonical edit happens in `~/.claude-sdd` (active profile); the other two are copies.
- **Additive only:** do not alter the behavior of the existing single-subagent flow.
- **No new dependency** on `researcher-mcp` changes — fan-out reuses its tool matrix and the existing `## Findings` schema.
- **Spec:** `docs/superpowers/specs/2026-06-20-research-fanout-mode-design.md`.

---

### Task 1: Add fan-out branch to the canonical SKILL.md

**Files:**
- Modify: `~/.claude-sdd/skills/research-subagent/SKILL.md`

**Interfaces:**
- Consumes: existing `## Findings` response schema and the researcher MCP tool matrix (unchanged).
- Produces: new headings `## Mode Selection`, `## Fan-out Flow (broad subjects)`, `## Fan-out Subagent Prompt Template`; renamed heading `## Single Flow (default)` (was `## Flow`); appended fan-out entries under `## Common Mistakes`.

- [ ] **Step 1: Update the frontmatter `description`**

Replace the existing `description:` line with:

```
description: Use when the user runs /research-subagent or asks for deep research, a full report, or research where the main context should not absorb raw search results — including mapping a broad subject across multiple angles (fan-out). Spawns one or more general-purpose subagents that call the researcher MCP and return only synthesized findings. Prefer /research-web for quick inline lookups.
```

- [ ] **Step 2: Insert `## Mode Selection` immediately after the one-line intro**

After the line `Spawn a subagent that calls the researcher MCP. Main context only sees the synthesis.` and before `**REQUIRED SUB-SKILL:** researcher-mcp …`, insert:

```markdown
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
```

- [ ] **Step 3: Rename the existing `## Flow` heading**

Change the heading `## Flow` to `## Single Flow (default)`. Leave its body unchanged.

- [ ] **Step 4: Insert `## Fan-out Flow (broad subjects)` after the Single Flow section**

Insert immediately before `## Key Design Notes`:

```markdown
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
```

- [ ] **Step 5: Insert `## Fan-out Subagent Prompt Template` after the existing template**

Insert immediately after the existing `## Subagent Prompt Template` section (before `## Key Design Notes` / `## Fan-out Flow`, ordering with Step 4 is fine either way):

````markdown
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
````

- [ ] **Step 6: Append fan-out entries to `## Common Mistakes`**

Add these bullets at the end of the existing `## Common Mistakes` list:

```markdown
- **Fanning out without grounding first.** Subagents then all re-discover the basics — wasted tokens. Ground until you can name distinct angles.
- **Overlapping angles.** Vague boundaries = duplicate work. Make angles MECE; give each an explicit "do NOT cover" line.
- **Over-spawning.** More subagents ≠ better. Spawn the fewest that cover the distinct angles; fan-out is ~N× tokens.
- **Concatenating instead of reconciling.** Synthesis must dedup, resolve contradictions, and flag gaps — not staple the blocks together.
- **Fanning out a narrow query.** If one search answers it, use Single. Fan-out is an escalation for breadth.
```

- [ ] **Step 7: Verify the canonical file has every new section**

Run:
```bash
grep -c -E "^## (Mode Selection|Single Flow \(default\)|Fan-out Flow|Fan-out Subagent Prompt Template)" ~/.claude-sdd/skills/research-subagent/SKILL.md
```
Expected: `4`

Also confirm the old `## Flow` heading is gone:
```bash
grep -c "^## Flow$" ~/.claude-sdd/skills/research-subagent/SKILL.md
```
Expected: `0`

---

### Task 2: Mirror the file to the other two profiles and verify parity

**Files:**
- Modify: `~/.claude/skills/research-subagent/SKILL.md`
- Modify: `~/.claude-kat/skills/research-subagent/SKILL.md`

**Interfaces:**
- Consumes: the finalized canonical file from Task 1.
- Produces: three byte-identical `SKILL.md` files.

- [ ] **Step 1: Copy the canonical file over both other profiles**

```bash
cp ~/.claude-sdd/skills/research-subagent/SKILL.md ~/.claude/skills/research-subagent/SKILL.md
cp ~/.claude-sdd/skills/research-subagent/SKILL.md ~/.claude-kat/skills/research-subagent/SKILL.md
```

- [ ] **Step 2: Verify all three are byte-identical**

```bash
diff ~/.claude-sdd/skills/research-subagent/SKILL.md ~/.claude/skills/research-subagent/SKILL.md && \
diff ~/.claude-sdd/skills/research-subagent/SKILL.md ~/.claude-kat/skills/research-subagent/SKILL.md && \
echo "ALL THREE IDENTICAL"
```
Expected: `ALL THREE IDENTICAL` (no diff output).

---

### Task 3: Branch, commit the spec + plan, and acceptance read-back

**Files:**
- Repo docs only: `docs/superpowers/specs/2026-06-20-research-fanout-mode-design.md`, `docs/superpowers/plans/2026-06-20-research-fanout-mode.md`
- (The skill files in `~/.claude*` are user config, not tracked by this repo.)

**Interfaces:**
- Consumes: the completed skill edits (Tasks 1–2).
- Produces: a feature branch with the spec + plan committed.

- [ ] **Step 1: Acceptance read-back of branch logic**

Read `~/.claude-sdd/skills/research-subagent/SKILL.md` start-to-finish and confirm, with no ambiguity:
- A **narrow** query routes to Single Flow (no grounding loop, no fan-out).
- A **broad** subject routes to Fan-out Flow (ground → angles → parallel subagents → reconcile).
- An **explicit count** ("in 5 subagents") fixes N and proceeds silently.
Fix any wording that leaves the branch choice unclear, then re-mirror (Task 2 Step 1–2).

- [ ] **Step 2: Create a feature branch (we are on `main`)**

```bash
git -C /home/marius/work/claude/claude-plugins checkout -b feat/research-fanout-mode
```

- [ ] **Step 3: Commit the spec + plan**

```bash
git -C /home/marius/work/claude/claude-plugins add docs/superpowers/specs/2026-06-20-research-fanout-mode-design.md docs/superpowers/plans/2026-06-20-research-fanout-mode.md
git -C /home/marius/work/claude/claude-plugins commit -m "docs(research): spec + plan for /research-subagent fan-out mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Confirm the commit landed**

```bash
git -C /home/marius/work/claude/claude-plugins log --oneline -1
```
Expected: the `docs(research): spec + plan …` commit on `feat/research-fanout-mode`.

---

## Self-Review

**1. Spec coverage:**
- Activation / auto-detect breadth → Task 1 Step 2 (Mode Selection). ✓
- Ground-first loop → Task 1 Step 4 (Fan-out Flow §1). ✓
- Decompose, model decides count, MECE coverage map → §2. ✓
- Show angles then go → §3. ✓
- Four-axis subagent brief → Task 1 Step 5 (template: angle + boundary + format + tools). ✓
- Synthesize by reconciliation → §5. ✓
- When NOT to fan out → §5 fallback + Common Mistakes. ✓
- Three-profile parity → Task 2. ✓
- Verification cases → Task 3 Step 1 + Task 1 Step 7 + Task 2 Step 2. ✓

**2. Placeholder scan:** The only `<...>` tokens are inside the prompt template, where they are intentional substitution slots (matches the existing single-subagent template style). No TBD/TODO. ✓

**3. Type consistency:** Heading names used in verification (`## Mode Selection`, `## Single Flow (default)`, `## Fan-out Flow (broad subjects)`, `## Fan-out Subagent Prompt Template`) match the insert steps exactly. ✓
