# Prompt-Hamsa Eval — Results (POC → prod)

**Status:** harness is prod-ready and validated across the full matrix (detects cost
wins, detects behavioral wins, stays silent on self-healing flaws). Single-family
generation; n=5 on the live archetypes.
**Date:** 2026-06-14
**Generators:** Claude (runs 1–2), Gemini Flash-Lite (runs 3–8). **Graders:** Gemini
3.5/2.5-flash (LLM), deterministic checks, + a Claude cross-family grader (run 8).

## Runs

| # | archetype | downstream | grader / metric | result |
|---|---|---|---|---|
| 1 | D missing-contract | Claude | Gemini blind — hallucination | **NULL** (0/3 vs 0/3) |
| 2 | E placement-defect | Claude | deterministic — leak | **NULL** (5/5 vs 5/5) |
| 3 | E placement-defect | Flash-Lite | deterministic | **NULL** (5/5 vs 5/5) |
| 4 | B pure-decoration | Flash-Lite | tokens + exact (n=1) | −70% tokens; acc 8/8→7/8 |
| 5 | B pure-decoration (powered) | Flash-Lite | exact, n=5 | acc 1.00→0.90; **litotes a8 5/5→2/5** |
| 6 | F negation-only | Flash-Lite | len + coverage, n=5 | **NULL** (both 1.00) |
| 7 | **G capability/hidden-rules** | Flash-Lite | routing acc, n=5 | **acc 0.75→1.00 (+0.25) — BARK** |
| 8 | cross-family grader | — | Gemini vs Claude on coverage (truth 3/2/1/0) | **DIVERGE on s3** (Gemini 2, Claude 1, truth 1) |

## Verdict — instrument validated, three ways
- **Cost win (B):** detected. The powered re-run also caught a real **tail** regression
  (litotes 100%→40%) the n=1 run only hinted at — proof the harness sees tradeoffs, not
  just headlines.
- **Behavioral win (G):** detected (+0.25 routing accuracy) where the flaw is information
  the model *cannot* guess.
- **Self-healing flaws (D, E, F):** correctly silent. The harness does not reward
  plausible-looking edits.

An eval that always says "improved" is worse than none. This one discriminates in both
directions.

## The law this harness discovered
> **Prompt quality is visible to an eval only where the model cannot compensate on its
> own:** cost (always — a property of the prompt, not the model), decisive
> information/capability gaps the model can't guess (G), or the hard tail (B's litotes).
> Behaviors a capable model already self-regulates — safety (D hallucination, E PII),
> basic formatting, conciseness on easy tasks (F) — are **invisible**, because the model
> floors them regardless of prompt quality.

Corollaries:
1. **Inspection ≠ measurement** — four "obvious" improvements measured null; one cost-win
   hid a quality regression in the tail. The designer's own predictions ("weak model
   leaks", "F barks") were refuted by data twice.
2. **Safety-flavored flaws self-heal at every tier** (incl. Flash-Lite) — park them; they
   need a genuinely flaw-prone model or adversarial pressure to be testable.
3. **Cross-family graders diverge** (row-14, run 8): Gemini over-credited a vague summary;
   Claude matched truth. Deterministic metrics are trustworthy; a single-family LLM grader
   is not, for subjective metrics.

## Prod harness
- `harness.py` + `archetypes.py` — reusable; live archetypes B, G; D/E/F parked.
- Deterministic metrics are authoritative; `coverage_llm` carries the cross-family caveat.
- `crossfamily_check.py` — the row-14 probe, reproducible.
- Cost of the entire arc: a few hundred Gemini Flash/Flash-Lite calls. Pennies.

## Still open / future
- Power up `coverage_llm` with a cross-family or stronger grader (or drop it for a
  deterministic coverage proxy).
- Add capability archetypes beyond G (the productive direction); harden D/E/F only if a
  flaw-prone downstream model is wanted.
- Wire the harness into the Hamsa's workflow as the "drafted eval" its SKILL.md asks for.
