# Prompt-Hamsa Eval Harness

A small, reusable harness to measure whether a Hamsa prompt-rewrite actually improves
downstream behaviour — by measurement, not inspection. Built and validated 2026-06-14
(POC → prod). Full story in `RESULTS.md`; original design in `POC.md`.

## Run

```bash
set -a; . .env; set +a            # GEMINI_API_KEY lives in .env (gitignored)
python3 harness.py                # runs non-parked archetypes (B, G), n=5, temp 0.7
python3 harness.py --only B,G,F,E,D --n 5 --temp 0.7   # explicit; --only un-parks
python3 crossfamily_check.py      # row-14 grader-divergence probe
```

Summary prints to stdout; full per-trial results land in `results/run-<ts>.json`.
Env: `GEMINI_API_KEY` (required), `GEN_MODEL` (default `gemini-flash-lite-latest`),
`GRADE_MODEL` (default `gemini-2.5-flash`).

## What it does

Each archetype pairs a flawed **control** prompt with the Hamsa's **treatment** rewrite,
runs both on a downstream model over `n` trials, grades each output per metric, and
reports the per-arm means and the delta.

| archetype | flaw | metric(s) | grader | status |
|---|---|---|---|---|
| **B** | bloated decoration | prompt token cost + accuracy | deterministic | **LIVE — barks** (−70% tokens; tail quality dip) |
| **G** | hidden rules the model can't guess | routing accuracy | deterministic | **LIVE — barks** (+0.25 acc) |
| F | "don't be verbose", no bound | length + coverage | det + LLM | PARKED — self-heals |
| E | masking rule after leaking examples | leak | deterministic | PARKED — self-heals |
| D | no escape hatch | hallucination | LLM | PARKED — self-heals |

`PARKED` archetypes are kept for the record but skipped by default — their flaws
self-heal on a capable model, so they produce no signal (see `RESULTS.md`).

## What this harness taught us

1. **Inspection ≠ measurement.** Four "obvious" improvements measured null.
2. **Prompt quality is invisible to behavioral metrics on easy tasks with a capable
   model** — the model self-heals the flaw. It shows up only in: **cost** (B),
   **decisive information/capability gaps** the model can't guess (G), or the **hard
   tail** (B's litotes case, 5/5→2/5 under the cut).
3. **Safety-flavored flaws** (hallucination, PII leak) self-heal at *every* model tier
   tested, including Flash-Lite.

## Graders & the cross-family caveat

- **Deterministic** (`exact_label`, `exact_choice`, `no_leak`, `len_le`) — authoritative,
  no LLM in the loop. Prefer these.
- **LLM** (`coverage_llm`, Gemini) — `crossfamily_check.py` found Gemini and a Claude
  grader **diverge on borderline cases** (Gemini over-credited a vague summary, 2 vs
  truth 1; Claude matched truth). Do not rely on a single-family LLM grader for
  subjective metrics without a cross-check; treat coverage as advisory.

## Files

```
harness.py            runner (loads archetypes, runs arms, grades, aggregates, writes results)
archetypes.py         specs: control/treatment prompts, inputs+gold, metrics
crossfamily_check.py  row-14 grader-divergence probe
results/              run-<ts>.json outputs
POC.md / RESULTS.md   the POC design + the findings writeup
.env                  GEMINI_API_KEY (gitignored)
```
