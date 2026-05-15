#!/usr/bin/env python3
"""eval/scripts/gold-label.py — strong-panel calibration via D-7 substitute.

Loads candidate responses from an existing variance run, runs the gold
panel (premium models) on them, and computes Cohen's κ between the cheap
judge panel and the gold panel per criterion.

Outputs:
  eval/judge/calibration/gold-run-<n>.json     — per-case gold labels
  eval/judge/calibration/kappa-vs-strong-<n>.json — κ result

CRITICAL: the κ produced here is NOT vs human. See D-7. Threshold is 0.7,
not 0.6, to compensate for inter-LLM agreement inflation.

Usage:
  ./gold-label.py --variance-run eval/baselines/2026-05-15-tightened/ml-training-takin/variance-run-05.json

Env:
  OPENROUTER_API_KEY
"""

from __future__ import annotations
import argparse, json, os, sys, traceback
from pathlib import Path
from datetime import datetime, timezone

# Reuse harness primitives
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import (  # type: ignore
    call, extract_text, render_judge_prompt, parse_judge_output,
)
import yaml


GOLD_JUDGES = [
    ("gold-anthropic", "anthropic/claude-opus-4.7"),
    ("gold-openai",    "openai/gpt-5-pro"),
    ("gold-google",    "google/gemini-3.1-pro-preview"),
]
GOLD_PANEL_VERSION = 1
KAPPA_TARGET = 0.7  # raised from 0.6 under D-7


def cohens_kappa(pairs: list[tuple[int, int]]) -> dict:
    """Compute Cohen's κ for binary classification."""
    n = len(pairs)
    if n < 2:
        return {"n": n, "kappa": None, "reason": "too few pairs"}
    po = sum(1 for a, b in pairs if a == b) / n
    a_pos = sum(1 for a, _ in pairs if a == 1) / n
    b_pos = sum(1 for _, b in pairs if b == 1) / n
    pe = a_pos * b_pos + (1 - a_pos) * (1 - b_pos)
    if pe == 1.0:
        kappa = 1.0 if po == 1.0 else 0.0
    else:
        kappa = (po - pe) / (1 - pe)
    return {
        "n": n,
        "p_observed": round(po, 4),
        "p_expected": round(pe, 4),
        "kappa": round(kappa, 4),
    }


def score_with_gold_judge(
    judge_label: str, judge_model: str,
    judge_template: str, method_reference: str,
    specialist: str, case_id: str, user_message: str, candidate_response: str,
    ideal_rubric: list,
) -> dict:
    """One gold-panel judge scores one case. Mirrors harness.score_case_with_judge but with premium models."""
    rubric_yaml = yaml.safe_dump(ideal_rubric, sort_keys=False)
    prompt = render_judge_prompt(
        judge_template,
        specialist=specialist,
        case_id=case_id,
        user_message=user_message,
        candidate_response=candidate_response,
        rubric_yaml=rubric_yaml,
        method_reference=method_reference,
    )
    # GPT-5-Pro is a reasoning model; same effort=low pattern as cheap GPT-5.
    reasoning = {"effort": "low"} if judge_model.startswith("openai/") else None
    # Premium models can be slow — bump timeout to 600s (was 300 in cheap path).
    resp = call(judge_model, [{"role": "user", "content": prompt}],
                max_tokens=8000, temperature=0, reasoning=reasoning, timeout=600)
    raw = extract_text(resp)
    parsed = parse_judge_output(raw)
    scores = {}
    if parsed and isinstance(parsed.get("rubric_scores"), list):
        for r in parsed["rubric_scores"]:
            if isinstance(r, dict) and "criterion" in r and "score" in r:
                try:
                    scores[r["criterion"]] = int(r["score"])
                except (TypeError, ValueError):
                    pass
    return {
        "judge": judge_label,
        "model": judge_model,
        "parsed_ok": parsed is not None,
        "scores": scores,
        "usage": resp.get("usage", {}),
        "raw_text": raw,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variance-run", required=True, help="Path to a variance-run-NN.json from prior cheap-panel run")
    parser.add_argument("--output-dir", default=None, help="Defaults to eval/judge/calibration/")
    args = parser.parse_args()

    variance_run = Path(args.variance_run)
    if not variance_run.is_file():
        raise SystemExit(f"missing variance run file: {variance_run}")

    eval_dir = HERE.parent
    repo_root = eval_dir.parent
    out_dir = Path(args.output_dir) if args.output_dir else (eval_dir / "judge" / "calibration")
    out_dir.mkdir(parents=True, exist_ok=True)

    cheap_run = json.loads(variance_run.read_text())
    specialist = cheap_run["specialist"]
    print(f">>> specialist:        {specialist}")
    print(f">>> cheap panel run:   {variance_run}")
    print(f">>> gold panel:        {[m for _, m in GOLD_JUDGES]}")

    judge_template = (eval_dir / "judge" / "prompt.md").read_text()
    method_reference = (eval_dir / "judge" / "rubrics" / f"{specialist}.md").read_text()
    # Load original fixtures for ideal_rubric (kept as authoritative source)
    fixtures_by_id = {}
    for p in sorted((eval_dir / "fixtures" / specialist).glob("case-*.yaml")):
        with p.open() as f:
            fx = yaml.safe_load(f)
        fixtures_by_id[fx["case_id"]] = fx

    gold_cases = []
    for case in cheap_run["cases"]:
        cid = case["case_id"]
        fx = fixtures_by_id.get(cid)
        if fx is None:
            print(f"  skipping {cid}: fixture not found")
            continue
        print(f"\n>>> case {cid}: gold-panel scoring...")
        gold_results = []
        for label, model in GOLD_JUDGES:
            print(f"  gold {label}...")
            result = score_with_gold_judge(
                label, model, judge_template, method_reference,
                specialist, cid, fx["input"]["user_message"], case["candidate_response"],
                fx["ideal_rubric"],
            )
            if not result["parsed_ok"]:
                print(f"  WARN: {label} unparseable", file=sys.stderr)
            gold_results.append(result)

        # Per-criterion gold majority vote
        criterion_names = [list(entry.keys())[0] for entry in fx["ideal_rubric"] if isinstance(entry, dict)]
        per_criterion = []
        for name in criterion_names:
            votes = [r["scores"].get(name) for r in gold_results]
            present = [v for v in votes if v is not None]
            if not present:
                majority = 0
                split = True
            else:
                ones = sum(1 for v in present if v == 1)
                zeros = len(present) - ones
                majority = 1 if ones > zeros else 0
                split = (ones == zeros) or (len(present) < len(votes))
            per_criterion.append({
                "criterion": name,
                "gold_judge_scores": {r["judge"]: r["scores"].get(name) for r in gold_results},
                "gold_majority": majority,
                "gold_panel_split": split,
            })

        gold_cases.append({
            "case_id": cid,
            "per_criterion": per_criterion,
            "gold_raw": [{"judge": r["judge"], "parsed_ok": r["parsed_ok"], "usage": r["usage"]} for r in gold_results],
        })

    # Save gold run
    existing = sorted(out_dir.glob("gold-run-*.json"))
    n_iter = len(existing) + 1
    gold_out_path = out_dir / f"gold-run-{n_iter:02d}.json"
    gold_out_path.write_text(json.dumps({
        "specialist": specialist,
        "gold_panel_version": GOLD_PANEL_VERSION,
        "iteration": n_iter,
        "source_cheap_run": str(variance_run),
        "cases": gold_cases,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))
    print(f"\n>>> wrote gold-run: {gold_out_path}")

    # Compute κ between cheap panel and gold panel
    pairs: list[tuple[int, int]] = []
    detail = []
    for cheap_case in cheap_run["cases"]:
        cid = cheap_case["case_id"]
        gold_case = next((g for g in gold_cases if g["case_id"] == cid), None)
        if gold_case is None:
            continue
        cheap_by_crit = {c["criterion"]: c["majority"] for c in cheap_case["per_criterion"]}
        gold_by_crit = {c["criterion"]: c["gold_majority"] for c in gold_case["per_criterion"]}
        for crit in cheap_by_crit:
            if crit in gold_by_crit:
                a = cheap_by_crit[crit]
                b = gold_by_crit[crit]
                pairs.append((a, b))
                detail.append({"case_id": cid, "criterion": crit, "cheap": a, "gold": b, "match": a == b})

    kappa_result = cohens_kappa(pairs)
    verdict = "PASS" if (kappa_result.get("kappa") or 0) >= KAPPA_TARGET else "ITERATE"
    kappa_out_path = out_dir / f"kappa-vs-strong-{n_iter:02d}.json"
    kappa_out_path.write_text(json.dumps({
        "iteration": n_iter,
        "n_paired_items": kappa_result["n"],
        "p_observed": kappa_result.get("p_observed"),
        "p_expected": kappa_result.get("p_expected"),
        "kappa_vs_strong_panel": kappa_result.get("kappa"),
        "target": KAPPA_TARGET,
        "target_basis": "D-7: panel-vs-strong-panel, not panel-vs-human. Threshold raised from 0.6 → 0.7 to compensate for inter-LLM agreement inflation.",
        "verdict": verdict,
        "detail": detail,
        "next_action": "Freeze baseline (./freeze-baseline.sh)." if verdict == "PASS" else "Edit eval/judge/prompt.md to tighten criteria; re-run gold-label.py.",
        "warning": "kappa_vs_strong_panel != kappa_vs_human. LLMs share biases. See D-7.",
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))

    print()
    print(f"{'cheap':<6} {'gold':<6}  case / criterion")
    print("-" * 80)
    for d in detail:
        mark = "✓" if d["match"] else "✗"
        print(f"{d['cheap']:<6} {d['gold']:<6}  {mark} {d['case_id']} / {d['criterion']}")
    print()
    print(f"paired items:                 {kappa_result['n']}")
    print(f"p_observed:                   {kappa_result.get('p_observed')}")
    print(f"p_expected:                   {kappa_result.get('p_expected')}")
    print(f"κ vs strong panel:            {kappa_result.get('kappa')}  (target ≥ {KAPPA_TARGET})")
    print(f"verdict:                      {verdict}")
    print(f"output:                       {kappa_out_path}")
    print()
    print("WARNING: κ vs strong panel ≠ κ vs human. LLMs share biases.")
    print("Replace with human anchor when feasible. See D-7.")

    if verdict != "PASS":
        sys.exit(4)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr); sys.exit(130)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc(); sys.exit(1)
