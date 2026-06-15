# Hamsa Eval × prompt-engineering — Integration Brief

**Status:** pre-brainstorm handoff (written 2026-06-14 to survive session compaction).
**Next session:** brainstorm how to integrate our cross-family eval work into the
`prompt-engineering` framework. Start by re-reading this file + `RESULTS.md`.

## TL;DR
Do **not** grow this standalone harness into a production suite. `prompt-engineering`
(`~/work/claude/prompt-engineering`) is the more mature prompt-testing framework. Fold our
novel pieces into it — chiefly **cross-family grading**. And use `prompt-engineering` (not
this harness) to test the **Hamsa skill's own behavior** — a layer this harness can't reach.

## ⚠ Recon corrections (verified 2026-06-14, supersede stale claims below)

Scouted the **actual** `prompt-engineering` source this session (not the prior read-only
notes the rest of this file was built from). Three load-bearing claims were stale; the
originals are left in place under this banner as an audit trail.

**F-1 — Phase 2 (claude-code adapter) IS implemented, not blocked. [severity: high]**
`src/prompt_tdd/adapters/claude_code.py` → `ClaudeCodeRegistry` (L45-272) is fully built:
runs headless sessions (`_evaluate_handler`), installs hooks, finds + parses transcripts
(`_parse_transcript`), reads/writes markdown sections (`_read_md_section`/`_write_md_section`),
estimates cost. **Zero** `not-implemented` raises anywhere in `src/`. The "## map" Status
bullet ("Phase 2 NOT implemented — `prompt-tdd run` raises 'not yet implemented'") is FALSE
as of today. *Counterfactual: the brainstorm asserted "the blocked Phase 2" and scoped the
SDK path around it; the SDK is in fact the fully-wired path. And the adapter that edits md
sections + runs headless sessions is exactly the machinery to test the Hamsa skill itself.*

**F-2 — `crossfamily_check.py` has NO divergence metric to migrate. [severity: med]**
It is a one-shot probe: `grade()` calls Gemini via raw HTTP, module-level `s`/`g` score the
SUMS, and L52-53 `print()` a hardcoded observed split ("Gemini s3=2 vs Claude s3=1 vs
truth=1"). No κ, no agreement computation, no automated cross-family comparison — the
divergence was read off printed scores by hand. The "migrate cross-family grading (see
crossfamily_check.py)" item overstates reusability: the **metric must be built from scratch**;
only the *fixture* (SUMS/TRUTH + observed split) and the *Gemini-call shape* are reusable.
*Counterfactual: a subagent told to "migrate the divergence check" would have found nothing
to migrate and flailed.*

**Correction (A/B) — `SuiteResult.compare()` (types.py L176-199) is STATUS-only.**
It diffs PASS/FAIL per scenario (regressions/improvements/unchanged/new); it does **not**
compare scores. So baseline-compare is blind to sub-threshold score movement — the exact
small-effect regime RESULTS.md says dominates prompt quality. This UPGRADES paired-A/B-with-CI
from "ergonomic nicety" to "closes a real blind spot." (Also: `compare` lives on `SuiteResult`,
not `BaselineStore` as the map below says.)

**W-1 — Pre-build recon caught three stale premises before any code was written.**
Also verified the panel cut point: `run_assertions(judge_model=...)` → `_run_tier3` (L258,
where the judge is constructed) — **MATCH**, that is where `PanelJudge` plugs in.
*Counterfactual: without this scout the plan would have rested on a fictional Phase-2 blocker
and a non-existent divergence metric — two of its load-bearing claims.*

**Net effect on the plan:** SDK is the primary, fully-wired home — build the `Provider`
protocol + `PanelJudge` there with confidence; testing the Hamsa skill *itself* is buildable
**today** via `ClaudeCodeRegistry`; the cross-family MVP **builds** the κ/divergence metric
(reusing only the fixture + Gemini call); A/B-with-CI is justified by a real status-only
blind spot, not just ergonomics.
## Why they're not redundant — different layers
- **prompt-engineering** tests Claude Code prompt *artifacts* (hooks, skills, CLAUDE.md
  sections) by running headless `claude -p` sessions and asserting on the transcript/trace.
- **this harness** (`claude-plugins/buddy/tests/prompt-hamsa-eval`) tests *task-prompt
  quality* via a downstream-model A/B (control vs treatment).
- The Hamsa IS a Claude Code skill → prompt-engineering is the right tool to test the Hamsa
  itself; this harness tests the *task prompts the Hamsa critiques*. Neither subsumes the other.

## prompt-engineering — map (from read-only exploration, 2026-06-14)
- **TDD framework:** YAML scenarios + tiered assertions — T1 deterministic output
  (contains/matches/regex), T2 trace/tool-calls (tool_called, step_order, token_usage),
  T3 LLM-judge (rubric/factuality), T4 custom (python/shell). `runs: N` + `pass_threshold`.
- **Baseline/regression:** `BaselineStore` + `SuiteResult.compare()` (regressions/improvements).
- **Optimization:** `optimize/textgrad.py` (LLM critique+rewrite), `optimize/mipro.py`
  (DSPy MIPROv2 Bayesian search). Orthogonal to eval — we don't mutate prompts.
- **Registry/adapter pattern** (`registry.py`, `adapters/claude_code.py`), Click CLI (`cli.py`).
- **Status:** bash runner (`tests/runner.sh`) WORKS. Python SDK Phase 1 done; **Phase 2
  (claude-code adapter) NOT implemented** — `prompt-tdd run` raises "not yet implemented".
- **Models: Anthropic-ONLY.** `judge_model=claude-haiku-4-5-20251001`,
  `feedback_model=claude-sonnet-4-6`. Locked to the `anthropic` SDK. No cross-family, no bias audit.
- **Maturity:** ~1,700 LOC SDK + ~500 LOC bash; 1 scenario suite (`tests/suites/hooks/`);
  no CI wiring. Proof-of-concept / dogfooding scale.
- **Key files:**
  - `src/prompt_tdd/judge.py` — LLMJudge (T3), **Anthropic-only** ← primary cross-family target
  - `src/prompt_tdd/assertions.py` — tiers 1–4
  - `src/prompt_tdd/runner.py`, `registry.py`, `baseline.py`, `cli.py`, `types.py`
  - `src/prompt_tdd/optimize/{textgrad,mipro,metrics}.py`
  - `prompt_tdd.yaml` — config; `tests/runner.sh` — working bash runner

## What to migrate FROM our harness INTO prompt-engineering
1. **Cross-family grading (TOP PRIORITY).** Their T3 judge is Anthropic-only — the exact
   single-family blind spot we *empirically proved* diverges (Gemini vs Claude disagreed on a
   borderline coverage case; see `crossfamily_check.py`). Add a non-Anthropic judge path + a
   κ/divergence check to `judge.py`. This both adds our unique value AND fixes a demonstrated
   weakness in their framework.
2. **Two-level control-vs-treatment A/B** as a scenario mode. Theirs compares against a
   *historical* baseline; parallel A/B in one run is cleaner for prompt-version comparison.
3. **Findings as design guidance.** Encode our "law" so their optimization loop (TextGrad/
   MIPRO) doesn't chase invisible behavioral wins (see RESULTS.md): prompt quality is visible
   only via cost / decisive info-capability gaps / the hard tail; behaviors a capable model
   self-regulates (safety, formatting, conciseness on easy tasks) are invisible.

## This harness — for reference (`claude-plugins/buddy/tests/prompt-hamsa-eval/`)
- `harness.py` (runner), `archetypes.py` (B,G live; D,E,F parked), `crossfamily_check.py`,
  `README.md`, `RESULTS.md`, `POC.md`, `.env` (gitignored), `results/`.
- Validation matrix: B cost-win (barks), G behavioral-win (barks), D/E/F null (self-heal),
  cross-family probe (graders diverge). Deterministic metrics trustworthy; single-family LLM grader not.

## Open questions for the brainstorm
- **Port vs adapter:** add cross-family directly to `judge.py`, or build a new
  `PromptRegistry` adapter (Gemini/cross-family) that plugs into the assertion tiers?
- **SDK vs bash:** put cross-family in the SDK (`judge.py`, independent of the blocked Phase 2)
  or the bash runner's `tests/lib/assertions.py`?
- **A/B shape:** a new scenario `mode: ab`, or a wrapper that runs two prompt versions + diffs?
- **Statistics:** both frameworks lack CIs/significance (only pass-rate/threshold). Add together?
- **Ownership:** does prompt-engineering absorb the eval, or does this harness stay a scratchpad?

## Pointers
- Tracker: `prompt-hamsa-audit-log` (claude-plugins) — rows 13–17 trace this whole arc.
- Uncommitted: `SKILL.md` done-state cuts + this entire eval dir, all in `claude-plugins`.
