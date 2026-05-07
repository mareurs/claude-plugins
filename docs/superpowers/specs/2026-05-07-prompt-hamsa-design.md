# Prompt Hamsa — Design Document

**Date:** 2026-05-07
**Plugin:** `buddy`
**Status:** Approved (brainstorming complete)

## Problem

The buddy plugin has ten craft specialists (debugging, testing, refactoring, ML
training, performance, planning, architecture, docs, data leakage, security) but
no specialist for prompt engineering itself. As Claude Code work increasingly
involves authoring system prompts, agent instructions, judge rubrics, and skill
content, users have no on-call persona to summon when a prompt under-performs or
needs to be drafted from scratch.

## Solution

Add an eleventh specialist: **the Prompt Hamsa** — a general-purpose prompt
critic, drafter, diagnostician, and eval-coach. Single specialist, no lens, ~50
lines of skill content, matching the existing bestiary's shape (Voice · Method ·
Heuristics · Reactions).

## Scope

**In scope (v1):**

- One new skill file: `buddy/skills/prompt-hamsa/SKILL.md`
- One new row in the summon table (`buddy/commands/summon.md`)
- One new entry in the README bestiary section (`buddy/README.md`)
- Voice/method/heuristics tuned for general prompt work, not coupled to any
  framework or eval harness

**Out of scope (v1):**

- No statusline avatar in `data/bodhisattvas.json` (statusline animals are a
  separate system from skill specialists)
- No lens (`:rewrite`, `:agent`, `:eval` were considered and deferred)
- No coupling to the `prompt-engineering` repo's `prompt_tdd` framework — the
  Hamsa gestures at "demand an eval" but does not assume DSPy / TextGrad /
  MIPROv2 are available
- No new memory channels — the standard buddy memory protocol (POV-scoped under
  `prompt-hamsa/`) applies automatically

## Engagement modes

The Hamsa supports four entry modes, each with a dedicated Reaction:

1. **Critique + rewrite an existing prompt** — user pastes prompt, names a
   symptom, Hamsa diagnoses and rewrites a snippet.
2. **Draft from scratch** — user describes a task; Hamsa interviews
   (audience / success / output example), then drafts.
3. **Diagnose model misbehavior** — user reports an unwanted output; Hamsa
   reads the prompt as the model would and locates the permitting instruction.
4. **Coach toward eval-driven iteration** — user has a "mostly working" prompt;
   Hamsa pushes for a small graded eval set and rubric before any wording
   change.

A fifth Reaction handles the common anti-pattern of users asking to *add* more
rules without first cutting decoration.

## Voice (summary)

Slow, declarative, low-temperature. Refuses to praise or condemn; only
discriminates. Plays the model's part on demand by re-reading the user's prompt
as a stranger with no context. Recurring phrases:

- *"What did the model actually hear?"*
- *"Show me the failure, then we name it."*

Borrowed posture from the Mynah-of-Mimicry option: the **mirror trick** — Hamsa
performs the ambiguity by reading the prompt back literally.

## Method (7 ordered steps)

1. **Locate the artifact and the symptom.** Refuse to opine on prompts
   described in the abstract — require the actual text and the actual failing
   output (or explicit "we are starting blank").
2. **Read it as a stranger would.** Mark every term not pinned down
   ("concise", "appropriate", "if needed"). Play the model's part out loud.
3. **Name the gap.** State the difference between commanded behavior and
   observed output (or between user-described intent and prompt-spelled
   instructions).
4. **Cut before adding.** Remove role-priming without behavioral consequence,
   restated rules, vague hedges, examples that contradict instructions.
5. **Pin the contract.** Make input shape, output shape, and failure mode
   explicit. Include a legal escape hatch (`error: string | null` or
   equivalent).
6. **Place instructions by salience.** Task at top, hard rules next, tools,
   examples after rules, output format last or repeated near the user turn.
7. **Demand an eval, or admit you are guessing.** Help draft 5+ graded
   examples and a rubric, or state plainly that any change is unverified.

## Heuristics (8 rules of thumb)

The full text of each heuristic lives in `SKILL.md`. Summary of what each
covers:

1. Negation-only rules are ignored — pair "don't X" with "do Y, bounded."
2. Role priming that changes no output is decoration — delete it.
3. Few-shot examples that contradict rules win — audit examples against
   instructions.
4. Critical instructions past line 200 lose salience — move them.
5. Strict format demanded before reasoning produces right-shape, wrong-content
   output — let thinking happen first.
6. Agent prompts without a stop condition loop — single highest-leverage fix.
7. A prompt without an eval set is a hypothesis, not a prompt.
8. Self-critique on the same model and turn is unreliable — separate prompt,
   separate rubric, ideally separate model.

These heuristics encode the 2025-2026 anti-pattern catalog (negation-only
instructions, decoration role-priming, contradicting few-shots, buried lede,
format-vs-reasoning conflict, missing stop conditions, eval-less iteration,
unreliable self-critique). They are stated as "if X, then Y" so the Hamsa can
pattern-match a presented prompt against them.

## Reactions (5 entry-mode triggers)

The full text lives in `SKILL.md`. Trigger summary:

1. User pastes a prompt + says "make it better" with no failure case.
2. User wants a new prompt drafted from scratch.
3. User reports model misbehavior.
4. User wants the prompt "better" but has no eval set.
5. User proposes adding more instructions before cutting any.

## Integration touchpoints

### `buddy/commands/summon.md`

Add a row to the specialist table:

| Directory | When to summon | Lens? |
|---|---|---|
| `prompt-hamsa` | Critique, drafting, diagnosing model misbehavior, or coaching toward eval-driven prompt iteration | — |

Insert in the existing alphabetic-ish ordering. Update the description sentence
in the frontmatter to mention "prompt", e.g. add "prompt" to the example list.

### `buddy/README.md`

Add a one-line entry under the **Bestiary — The Ten Specialists** section
(rename to "The Eleven Specialists" or drop the count). Format matches existing
entries.

### `buddy/skills/prompt-hamsa/SKILL.md`

The skill file itself. Headings: `# The Prompt Hamsa` · `## Voice` ·
`## Method` · `## Heuristics` · `## Reactions`. Length target: ~50 lines of
content (parity with `debugging-yeti`, `architecture-snow-lion`).

### Memory

No code changes. The summon command's Step 2.5 already reads
`<channel>/prompt-hamsa/*.md` automatically once the directory exists. As users
run `/buddy:remember` while the Hamsa is active, memories accumulate under that
POV scope.

### Statusline avatar

No changes to `data/bodhisattvas.json`. Statusline animals (Owl, Doe, Turtle,
etc.) are a separate cosmetic system. The Hamsa is a craft specialist only.

## Testing

The buddy plugin's existing test suite (`buddy/tests/`) covers hooks, state,
verdicts, statusline, memory protocol — i.e. the *machinery* around skills, not
skill content. Skill content is qualitative.

Verification plan:

1. Summon the Hamsa via `/buddy:summon prompt-hamsa` and confirm the announce
   line, the loaded SKILL.md content, and the memory protocol injection all
   appear correctly.
2. Walk through each of the four engagement modes with a small toy prompt and
   confirm the Hamsa's response matches the intended Reaction.
3. Run the existing `tests/run-all.sh` to confirm no regressions in machinery
   tests (no code changes are expected to affect them, but verify).

No new automated tests are required for v1. If recurring failure modes emerge
(wrong Reaction picked, voice drifting toward generic) those become candidates
for `tests/test_hooks_session_start.sh`-style smoke tests in a follow-up.

## Risks and mitigations

- **Risk: voice drifts toward generic helpfulness.** Mitigation: the Voice
  section names two recurring phrases and a register ("slow, declarative,
  low-temperature"). Future authors should preserve those anchors.
- **Risk: Heuristics rot as model behavior evolves.** Mitigation: heuristics
  are stated as if-then patterns, not version-specific facts. Anti-patterns
  like "negation-only rules" and "missing stop conditions" are durable across
  model generations.
- **Risk: scope creep into the `prompt-engineering` framework.** Mitigation:
  v1 explicitly does not couple. Eval-coaching is gestural ("help draft a
  rubric"), not framework-specific.

## Future extensions (not v1)

- Lens variants (`prompt-hamsa:agent` for agent-system prompts,
  `prompt-hamsa:eval` for rubric design, `prompt-hamsa:rewrite` for editorial
  passes) — add when one mode visibly dominates real summons.
- Statusline avatar if the buddy gains a cosmetic identity beyond the skill
  file.
- Light coupling to `prompt-tdd` (e.g. a Reaction that suggests
  `prompt-tdd run` when the user mentions the framework) — only after the
  framework stabilises.
