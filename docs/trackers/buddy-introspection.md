# Buddy Specialists — Hamsa Introspection Audit

> **Tracker schema:** audit_issues archetype (extended). Designed via `librarian(tracker_design)`.
> Plain-markdown fallback because `claude-plugins` is not registered as a codescout artifact repo.
> Promote to codescout artifact (`kind=tracker`) once registered.

## Live state

```yaml
specialists_scanned: 10/10
  - architecture-snow-lion
  - debugging-yeti
  - testing-snow-leopard
  - refactoring-yak
  - ml-training-takin
  - performance-lammergeier
  - planning-crane
  - docs-lotus-frog
  - data-leakage-snow-pheasant   # classic + llm lenses
  - security-ibex
specialists_pending: []
last_updated: 2026-05-15
```

## Systemic table — issues recurring across ≥3 specialists

These are the canonical rows. Per-specialist duplicates are not recorded; severity and fix apply uniformly unless noted.

| #  | Issue | Sev | Status | Heur | Lit | Fix | Applies to (N/10) |
|---:|-------|:---:|:------:|:----:|-----|-----|:-----------------:|
| S-1 | Heavy biographical role-priming (animal metaphor + multi-sentence persona biography) | high | open | H2 | arxiv 2311.10054, 2507.16076 | cut bio; keep one-line tone cue | **9** (ibex is light, others heavy) |
| S-2 | No I/O contract (no input/output shape, no escape hatch) | high | open | step-5 | — | adopt ibex-style Finding Format and/or output schema block | **9** (ibex has Finding Format) |
| S-3 | No soft scope rule for out-of-domain input | high | open | step-5 | arxiv 2505.18325 | adopt ibex-style "set scope, ask once" pattern | **8** (ibex + pheasant have explicit scope-ask) |
| S-4 | Closed-set Reactions (~5 pairs) without trigger-rationale | high | open | H3 | arxiv 2403.16512 | add _Applies: <Method/Heuristic ref>_ per Reaction; mark non-exhaustive | **10** |
| S-5 | No eval set (zero graded examples per specialist) | high | open | H7 | DSPy/Promptfoo/LangSmith 2025 | build shared harness 5×10; LLM-judge with per-Method rubric | **10** |
| S-6 | Declarative third-person framing vs interview-style | med | **wontfix-with-data** | H2 | arxiv 2507.16076 | T-33 dialogic draft + hamsa inspection on both variants: declarative wins on 6/7 dimensions; dialogic adds ~37% token cost without named benefit hypothesis. Forensic artifact at `buddy/skills/debugging-yeti/SKILL-dialogic.md`. See active-plan.md 2026-05-16 disposition entry. | **10** |

## Per-specialist issue table — unique gaps only

| #  | Specialist | Issue | Sev | Status | Heur | Lit | Fix | Eval |
|---:|------------|-------|:---:|:------:|:----:|-----|-----|:----:|
|  1 | architecture-snow-lion | _superseded by S-1_ | — | wontfix | — | — | see S-1 | — |
|  2 | architecture-snow-lion | _superseded by S-2_ | — | wontfix | — | — | see S-2 | — |
|  3 | architecture-snow-lion | _superseded by S-3_ | — | wontfix | — | — | see S-3 | — |
|  4 | architecture-snow-lion | _superseded by S-4_ | — | wontfix | — | — | see S-4 | — |
|  5 | architecture-snow-lion | _superseded by S-5_ | — | wontfix | — | — | see S-5 | — |
|  6 | architecture-snow-lion | Heuristic 7 names action without tool affordance | low | open | step-6 | — | add `symbols`/`grep` pointer parenthetical | none |
|  7 | architecture-snow-lion | No re-pin near user turn for long sessions | low | open | H4 | — | optional one-line re-pin at end | none |
|  8 | architecture-snow-lion | _superseded by S-6_ | — | wontfix | — | — | see S-6 | — |
|  9 | debugging-yeti | Method step 8 "explain to the mountain" decorative, no testable artifact | med | open | H2 | — | replace with "write the why in the commit message or PR description, in one sentence" | none |
| 10 | testing-snow-leopard | Method step 4 locks AAA pattern, ignores GWT alternative | low | open | step-6 | — | reframe as "use AAA or GWT — pick one and stay consistent" | none |
| 11 | refactoring-yak | Method step 6 "read aloud" for clearer name is unmeasurable | low | open | H2 | — | replace with "name passes the elevator test: a teammate understands the function from name alone" | none |
| 12 | refactoring-yak | Method step 4 names `replace_symbol`/`rename`/`move` — codescout-specific, untagged | low | open | step-6 | — | add note "(codescout `edit_code` action; IDE LSP rename if outside codescout)" | none |
| 13 | ml-training-takin | (none beyond systemic — exemplary specificity) | — | — | — | — | — | — |
| 14 | performance-lammergeier | Method step 6 references `perf stat` / cache misses — systems-language specific, may be off-topic for GC-lang user | low | open | step-6 | — | gate behind "(if systems language)" or move to a sub-bullet | none |
| 15 | planning-crane | Method step 7 uses "compaction" without definition; LLM-internal jargon | low | open | step-6 | — | define inline: "compaction = rewriting the remaining plan from scratch given what is now known, not patching" (the def is already there in body; promote it to first mention) | none |
| 16 | planning-crane | Reaction 3 "ten minutes of planning saves two hours" — quoted claim without citation | low | open | H7 | — | drop the figure or cite Boehm/PMI study; otherwise it's persona-vibes | none |
| 17 | docs-lotus-frog | Method step 7 "Schedule documentation review" — schedule mechanism unspecified | low | open | step-6 | — | replace with "update docs in the same commit as the code change; reject PRs that touch a feature without touching its docs" | none |
| 18 | data-leakage-snow-pheasant (llm) | Method step 4 inline 4-bias paragraph (a/b/c/d) is dense, scannability suffers | low | open | step-6 | — | break into sub-bullets, one per bias | none |
| 19 | data-leakage-snow-pheasant | Lens-dispatch pattern is a POSITIVE; promote to template for other multi-aspect specialists | low | wontfix | — | — | _no fix needed — see Cross-specialist patterns_ | n/a |
| 20 | security-ibex | Length 167 lines — highest of all specialists | low | open | H4 | — | accept (security complexity earns the budget); revisit if attention metrics show drift | none |
| 21 | security-ibex | Phase-2 taxonomy is OWASP-2017-flavored; ASVS / OWASP-2021 LLM categories not surfaced | med | open | — | OWASP LLM Top 10 (2024) | add an LLM-specific sub-category (prompt injection, insecure output handling, training-data poisoning) — even one bullet would close it | none |
| 22 | security-ibex | _superseded by S-4_ — Reactions still closed-set | — | wontfix | — | — | see S-4 | — |

**Status legend.** `open` = audit finding awaiting decision. `wontfix` = duplicates a systemic row; resolution happens at the systemic level. `in-progress`/`fixed` reserved for post-eval state changes.

## Cross-specialist patterns to promote

Security-ibex was either designed later or by someone with stronger prompt-engineering rigor. It solves four gaps the other 9 specialists exhibit. Treat its structure as a portable template:

| Pattern | What it is | Where it lives in ibex | Maps to systemic gap |
|---------|------------|------------------------|----------------------|
| **Operating Principles** | 3–5 non-negotiable rules above the Method, governing every output | `## Operating Principles` (5 items) | bounds drift; not directly a gap row but reduces #S-4 by raising salience of constraints over examples |
| **Phased Method with self-critique** | Numbered phases (Context → Action → Self-Critique); Phase 3 is mandatory anti-confabulation | `## Method — Three Phases` (Phase 3 = "do not skip") | reduces #S-5's blind spot — the persona checks itself before output |
| **Finding/Output Format** | Explicit output schema (Severity, Category, Location, Evidence, Exploit sketch, Fix, Confidence) | `## Finding Format` | closes #S-2 directly; gives reader predictable shape |
| **Self-Traps** | Named failure modes the specialist must avoid in itself | `## Self-Traps (Failure Modes to Avoid)` (6 items) | partial #S-5 substitute — internal eval rubric even without external eval suite |

**Pheasant lens-dispatch** is also a portable pattern: when one specialist covers multiple sub-domains, force the user to pick a lens or stop. Single prompt cannot serve both well — admit it.

## Audit scope and methodology

Hamsa-lens introspection of all 10 buddy specialists under `buddy/skills/`. Each
SKILL.md (and lens addendums for pheasant) was read as a stranger would read it, then
audited against:

1. **Hamsa heuristics (H1–H8)** — internal craft rubric: negation-only rules,
   role-priming earnings, few-shot/rule contradictions, salience placement,
   format-before-reasoning, stop conditions, eval presence, self-critique.
2. **2025–2026 prompt-engineering literature** — fetched via researcher MCP, single
   focused query (one batch). Key sources:
   - arxiv 2311.10054 — persona prompts are mostly stylistic, not reasoning-enhancing
   - arxiv 2507.16076 — biographical persona color can degrade up to 30%; interview-style framing more stable
   - arxiv 2505.18325 — RASS / soft scoping; hard refusal rules cause overrefusal
   - arxiv 2403.16512 — label-alignment failure in closed-set examples; mitigation via per-example trigger-rationale
   - DSPy / Promptfoo / LangSmith (2025) — generator + LLM-judge eval loops; PoLL panels

One row per gap. Issues recurring across ≥3 specialists are surfaced canonically in
**Systemic findings** (numbered S-N). Per-specialist rows record only **unique** gaps,
with duplicates of systemic rows marked `wontfix` pointing to the canonical S-N.

### Field semantics

| Field | Values | Notes |
|---|---|---|
| `specialist` | matches a dir under `buddy/skills/` | enum-locked after sweep |
| `severity` | `high` / `med` / `low` | per hamsa heuristics + lit backing |
| `status` | `open` / `in-progress` / `fixed` / `wontfix` | `fixed` requires `eval_status=passing` OR History note |
| `heuristic` | `H1`–`H8` or `step-N` or `—` | hamsa rubric ref |
| `lit_backing` | arxiv refs / source URLs / `—` | `—` = hamsa-internal, no external evidence |
| `fix_direction` | short imperative (cut X, rewrite as Y, add Z) | reflects decision, not done state |
| `eval_status` | `none` / `draft` / `passing` | systemic eval gap (S-5) blocks everything from reaching `passing` |

## Per-issue detail

### Systemic findings

#### S-1 — Heavy biographical role-priming

**Symptom:** Each specialist (except ibex) opens with 2–4 sentences of animal-biography
("guards the palace gate", "stands in still water", "rides thermals", etc.) and the
metaphor recurs through Method/Reactions. Aggregate cost across 9 specialists ≈ 900 tokens.

**Root cause:** Declarative biographical persona. arxiv 2507.16076 shows biographical
color can degrade task performance up to ~30%; arxiv 2311.10054 finds persona prompts
are mostly stylistic, not reasoning-enhancing.

**Fix:** Cut to a one-line tone cue per specialist (e.g. *"register: slow, declarative,
low-temperature"*). Retain the animal name as a hook for `/buddy:summon` ergonomics, but
strip biographical narrative from the Voice block and from interspersed references in
Method/Reactions.

**Predicted impact:** ~−80 tokens × 9 = −720 tokens total; lower risk of degradation;
same or better tone fidelity. Untested until S-5 is solved.

#### S-2 — No I/O contract

**Symptom:** 9 of 10 specialists declare no input shape, no output shape, no escape
hatch. Security-ibex is the exception with `## Finding Format`.

**Root cause:** Hamsa method step 5 violation. Behavior under unusual input is undefined.

**Fix:** Promote ibex's Finding Format pattern to all specialists. Each specialist
declares: input shapes accepted (typically 2–4), output shape (prose with cited
heuristic, or named structured fields), out-of-scope behavior (see S-3).

**Predicted impact:** Reduced drift on out-of-shape input. Token cost ~60/specialist.

#### S-3 — No soft scope rule

**Symptom:** 8 of 10 specialists have no rule for out-of-domain input. Ibex has
"set scope, ask once"; pheasant has "ask which lens or stop".

**Root cause:** Scope omitted. arxiv 2505.18325 shows hard refusal rules cause overrefusal;
recommended pattern is **soft scope** — ask a clarifying question, hand off to a more
apt specialist.

**Fix:** Per specialist, add: *"If the question is not about [domain markers] — ask one
clarifying question to confirm scope before answering. If confirmed out-of-scope, name
a more apt specialist (e.g. `/buddy:summon <name>`)."*

**Predicted impact:** Cleaner hand-offs, less off-domain hallucination.

#### S-4 — Closed-set Reactions without trigger-rationale

**Symptom:** Every specialist closes with ~5 Reactions formatted `trigger→response`.
No "why this applies" signal linking the trigger back to a Method step or Heuristic.

**Root cause:** arxiv 2403.16512 — **label-alignment failure**: models shoehorn novel
queries into the nearest example by surface form. Mitigation: each example carries an
intent-rationale.

**Fix:** Add a one-line `_Applies: <Method-N / Heuristic-N>_` italic line under each
Reaction trigger. Also add an explicit *"Reactions are illustrative, not exhaustive;
when no Reaction matches, derive response from Method + Heuristics."*

**Predicted impact:** Less surface shoehorning on novel inputs. Token cost ~40/specialist.

#### S-5 — No eval set (systemic across all 10)

**Symptom:** Zero graded examples per specialist. Every claim that a persona "works"
is unverified.

**Root cause:** Hamsa heuristic 7. Practitioner standard in 2025–2026 is
generator+LLM-judge loop scored against a gold dataset (DSPy/Promptfoo/LangSmith,
PoLL panels for cross-family judge bias).

**Fix:** Build a shared eval harness. Schema:

```
eval/
  fixtures/
    <specialist>/
      case-01.yaml   # input prompt + ideal output rubric
      case-02.yaml
      ...           # 5–10 cases per specialist; 50–100 total
  judge_prompt.md   # cross-family LLM judge with per-Method rubric
  run.sh            # generator → judge → score → diff vs baseline
```

Tooling pick: **DSPy** for optimization (eventually compile each persona automatically
against its rubric) and **Promptfoo** for fast regression on every prompt change.
Per LLM-lens research, use a 3-judge PoLL panel.

**Predicted impact:** Unblocks all other fixes. Without eval, every rewrite — including
S-1, S-2, S-3, S-4, S-6 — is a guess. **This is the highest-leverage single action.**

#### S-6 — Declarative vs interview-style

**Symptom:** All 10 specialists use declarative third-person Voice ("The Snow Lion
guards the palace gate"). None use simulate-an-expert-in-dialogue framing.

**Root cause:** arxiv 2507.16076 finds **interview-style** more stable and less
bias-prone than declarative assertion. Untested for these specific personas.

**Fix:** Experimental — once S-5 is solved, A/B each specialist's current declarative
voice against a dialogic recast (e.g. *"In this exchange, the assistant takes the role
of an architect who has watched systems grow, buckle, and be rebuilt"*). Roll out only
where eval shows measurable improvement.

**Predicted impact:** Unknown per-specialist; literature suggests a small-but-real
delta. Strictly gated on S-5.

### Per-specialist unique details

#### #6 — architecture-snow-lion — Heuristic 7 references action with no tool affordance

**Symptom:** *"Re-derive the architecture from the code's actual import graph and
compare."* No pointer to grep / symbols / how to actually do this inside Claude Code.

**Root cause:** Value stated without affordance.

**Fix:** Add a parenthetical: *"(use `symbols(path)` or `grep` for imports —
the truth is in the import graph, not the diagram)."*

**Predicted impact:** Low — ~15 tokens, guides action when relevant.

#### #7 — architecture-snow-lion — No re-pin near user turn

**Symptom:** Task framing only at top of prompt.

**Fix:** Optional. If conversations are typically long, add one-line re-pin near end.
Defer until conversation-length data exists.

#### #9 — debugging-yeti — Method 8 "explain to the mountain" decorative

**Symptom:** *"Before committing, articulate in one sentence why the fix is correct
and why the original code was wrong... The mountain does not accept patches."* The
"mountain" framing has no testable artifact.

**Fix:** *"Before committing, write in the commit message or PR description, in one
sentence, why the fix is correct and why the original code was wrong. If you cannot,
you have patched a symptom."* Same intent; the commit message is a real artifact a
reviewer can demand.

**Predicted impact:** Same craft discipline, externalized to a checkable surface.

#### #10 — testing-snow-leopard — AAA-only pattern lock

**Symptom:** Method 4 mandates Arrange-Act-Assert. Given-When-Then is equivalent and
widely used (BDD ecosystems). Single-style mandate creates friction for users in
BDD-style codebases.

**Fix:** *"Structure tests in a consistent pattern — AAA (Arrange-Act-Assert) or GWT
(Given-When-Then). Pick one and stay consistent."*

#### #11 — refactoring-yak — "Read aloud" is unmeasurable

**Symptom:** Method 6: *"Clearer name? Read it aloud."* Aesthetic instruction, no
measurable threshold.

**Fix:** *"Clearer name? Test: a teammate unfamiliar with the change should understand
what the function does from the name alone."*

#### #12 — refactoring-yak — Codescout-specific tool names untagged

**Symptom:** Method 4 names `replace_symbol`, `rename`, `move` without acknowledging
these are codescout MCP tools — a user without codescout sees unknown verbs.

**Fix:** *"...structured code operations (`edit_code` in codescout MCP; or your IDE's
LSP rename) over manual text editing."*

#### #14 — performance-lammergeier — Systems-language drift in Method 6

**Symptom:** *"In systems languages, measure cache miss rates with `perf stat`..."*
Half the audience (Python/JS/Go users) will skim past as irrelevant or stop reading.

**Fix:** Move to a sub-bullet or gate explicitly: *"For systems languages (Rust, C++,
C), additionally measure cache miss rates with `perf stat` — a cache-friendly data
layout can outperform an algorithmically superior but cache-hostile one."*

#### #15 — planning-crane — "Compaction" jargon unflagged

**Symptom:** Method 7: *"Build in compaction points."* The term is LLM-context-window
jargon. The definition follows (*"compaction means rewriting the remaining plan from
scratch..."*) but appears after the term.

**Fix:** Lead with the definition: *"Build in plan-rewrite points (LLM-context users
call this 'compaction'). After every 3–5 tasks, insert a review step..."*

#### #16 — planning-crane — Reaction 3 unsourced quantitative claim

**Symptom:** *"Ten minutes of planning saves two hours of wandering."* Sounds true,
no citation, no measurement. Persona vibe masquerading as data.

**Fix:** Either drop the figure (*"A few minutes of planning saves hours of wandering"*)
or cite a source. Boehm's COCOMO data is the closest defensible reference but it's
about software estimation, not LLM-pair-programming.

#### #17 — docs-lotus-frog — "Schedule" undefined

**Symptom:** Method 7: *"Schedule documentation review alongside code review."*
"Schedule" suggests a calendar tool; the actual mechanism is review-discipline at PR time.

**Fix:** *"Update docs in the same commit as the code change; PR reviewers reject
changes that touch a feature without touching its docs."*

#### #18 — data-leakage-snow-pheasant (llm) — Dense inline biases

**Symptom:** LLM lens Method 4 packs 4 named judge biases (self-preference, position,
verbosity, scoring instability) into one prose paragraph with inline (a)(b)(c)(d)
markers. Hard to scan; mitigation list at the end runs together with the bias list.

**Fix:** Split into sub-bullets:
```
- **(a) self-preference** — judges prefer text with lower perplexity vs their own outputs
- **(b) position bias** — 48.4% verdicts reverse on order swap (Wang 2023)
- **(c) verbosity bias** — longer responses score higher regardless of instruction-following
- **(d) scoring instability** — rubric item order shifts absolute scores

Mitigations:
- PoLL panel of ≥3 cross-family models
- Position-swap evaluation; flag verdict reversals
- Force CoT before final judgment
- Calibrate against human annotations until κ ≥ 0.6
```

**Predicted impact:** Same content, much higher scan density.

#### #19 — data-leakage-snow-pheasant — Lens dispatch is a POSITIVE pattern

**Note:** Not a gap. Pheasant forces lens selection (`classic` or `llm`) and stops
otherwise. This is a portable pattern for any specialist whose domain has divergent
sub-aspects (e.g. refactoring-yak could have `tactical` vs `architectural` lenses;
testing could have `unit` vs `integration` vs `property`). Documented under
**Cross-specialist patterns to promote**, not actioned per-specialist.

#### #20 — security-ibex — Length 167 lines

**Symptom:** Highest length of any specialist (others 47–60 lines). Token budget
roughly 3× per specialist baseline.

**Root cause:** Security complexity genuinely demands the additional sections
(Operating Principles, Severity Rubric, Finding Format, Taxonomy, Self-Traps).

**Fix:** Accept. Revisit if usage telemetry shows attention drift mid-session.

#### #21 — security-ibex — OWASP-2017-flavored taxonomy; LLM threats absent

**Symptom:** Phase-2 Taxonomy covers Input Validation, AuthN/AuthZ, Crypto, Code
Execution, Information Disclosure. Maps to OWASP Top 10 (2017–2021 web-app era).
**Missing:** OWASP LLM Top 10 (2024) categories — prompt injection, insecure output
handling, training-data poisoning, model DoS, supply chain risks for foundation
models, sensitive info disclosure in prompts.

**Root cause:** Specialist predates or did not absorb 2024 LLM-security taxonomy.

**Fix:** Add a sixth taxonomy sub-section: **LLM / AI Application** — with at minimum
prompt-injection (LLM01), insecure output handling (LLM02), and training-data
poisoning (LLM03) triggers. Even one bullet per category closes the obvious gap for
any user reviewing AI features.

**Predicted impact:** Brings ibex current for 2024–2026 security review work, which is
where most new buddy users likely operate.

#### #13 — ml-training-takin — No unique gaps recorded

The Takin's SKILL.md is the most-grounded in concrete numerical bounds (LR ranges,
gradient ratios, batch overfit threshold). It exhibits all 6 systemic gaps but no
unique per-specialist defect was found. Use as a positive reference for specificity.

## History

### 2026-05-15 — Sweep complete

- Initial sweep: architecture-snow-lion (8 issues).
- Researcher MCP query: persona-prompt patterns 2025-2026 (5 papers logged).
- Batch sweep: 9 remaining specialists read in parallel; hamsa lens applied.
- Restructured tracker: 6 systemic issues (S-1..S-6) + 14 per-specialist unique
  issues + 1 positive pattern (#19). 6 of architect's original 8 rows demoted to
  `wontfix` pointing to systemic.
- New section: **Cross-specialist patterns to promote** — surfaces 4 portable
  patterns from security-ibex + 1 from pheasant.
- All 10 specialists scanned. Sweep closed.

**Next steps (recommended order):**

1. **Solve S-5** (eval harness) — unblocks everything else.
2. **Implement Cross-specialist promote patterns** on 3 highest-traffic specialists
   first (likely debugging-yeti, planning-crane, architecture-snow-lion).
3. **Fix per-specialist unique issues** #6, #9, #11, #15, #17, #21 (highest-value
   small fixes).
4. **Defer S-1, S-2, S-3, S-6** until S-5 produces a baseline; large rewrites
   without eval are guesses.
5. **Promote tracker to codescout artifact** if `claude-plugins` gets registered
   as an artifact repo.
