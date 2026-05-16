#!/usr/bin/env python3
"""eval/scripts/harness.py — buddy-specialist eval harness (Python, OpenRouter-direct).

For v1, this is the primary eval engine. Promptfoo's role (D-1) narrows to
CI regression gating once a baseline exists; offline eval/variance/calibration
runs through this script.

Modes:
  single                — run all fixtures for a specialist once, emit scores.json
  variance --n N        — run all fixtures N times, emit per-run + aggregated variance.json

Inputs:
  --specialist <name>   — match a dir under eval/fixtures/
  --output-dir <path>   — base output dir (defaults to eval/baselines/<date>/<specialist>/)

Env:
  OPENROUTER_API_KEY    — required

Cost (rough, 2026 OpenRouter prices):
  Per case: 1 candidate call (~3-5K tokens out) + 3 judges × N criteria calls (~2K out each)
  Variance floor (5 runs × 3 cases): ~$0.50-2 total
"""

from __future__ import annotations
import argparse, json, os, sys, time, traceback
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from typing import Any
import yaml

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

JUDGES = [
    ("anthropic", "anthropic/claude-sonnet-4.6"),
    ("openai",    "openai/gpt-5"),
    ("google",    "google/gemini-2.5-pro"),
]
CANDIDATE_MODEL = "anthropic/claude-opus-4.7"
PANEL_VERSION = 1


def call(model: str, messages: list[dict], *, max_tokens: int = 4000, temperature: float = 0, reasoning: dict | None = None, timeout: int = 300) -> dict:
    """Call OpenRouter chat-completions. Returns the full response dict."""
    import http.client
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY missing")
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if reasoning is not None:
        payload["reasoning"] = reasoning
    body = json.dumps(payload).encode()
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/mareurs/claude-plugins",
        "X-Title": "buddy-eval-harness",
    }
    for attempt in range(5):
        # Build a fresh request each retry so any closed connections re-open
        req = Request(OPENROUTER_URL, data=body, headers=headers)
        try:
            resp = urlopen(req, timeout=timeout).read()
            return json.loads(resp)
        except HTTPError as e:
            err_body = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                wait = min(2 ** attempt, 30)
                print(f"  HTTP {e.code} ({model}), retrying in {wait}s: {err_body[:80]}", file=sys.stderr)
                time.sleep(wait)
                continue
            raise SystemExit(f"OpenRouter HTTP {e.code} for {model}: {err_body}")
        except (URLError, http.client.IncompleteRead, http.client.RemoteDisconnected, ConnectionError, TimeoutError, OSError) as e:
            if attempt < 4:
                wait = min(2 ** attempt, 30)
                print(f"  {type(e).__name__} ({model}), retrying in {wait}s: {str(e)[:80]}", file=sys.stderr)
                time.sleep(wait)
                continue
            raise SystemExit(f"OpenRouter network error for {model} after retries: {type(e).__name__}: {e}")
    raise SystemExit(f"OpenRouter call failed after retries: {model}")


def extract_text(resp: dict) -> str:
    msg = (resp.get("choices") or [{}])[0].get("message") or {}
    return (msg.get("content") or "").strip()


def call_candidate(skill_md: str, user_message: str) -> tuple[str, dict]:
    """Run the specialist on a user message. Returns (response_text, usage)."""
    messages = [
        {"role": "system", "content": skill_md},
        {"role": "user", "content": user_message},
    ]
    resp = call(CANDIDATE_MODEL, messages, max_tokens=4000, temperature=0.7)
    return extract_text(resp), resp.get("usage", {})


def render_judge_prompt(
    template: str, *,
    specialist: str, case_id: str, user_message: str,
    candidate_response: str, rubric_yaml: str, method_reference: str,
) -> str:
    """Substitute {{ var }} placeholders in the judge prompt template."""
    return (template
        .replace("{{specialist}}", specialist)
        .replace("{{case_id}}", case_id)
        .replace("{{user_message}}", user_message)
        .replace("{{candidate_response}}", candidate_response)
        .replace("{{rubric_criteria}}", rubric_yaml)
        .replace("{{specialist_method_reference}}", method_reference)
    )


def parse_judge_output(text: str) -> dict | None:
    """Extract the trailing JSON block from a judge response. Returns dict or None."""
    if "```json" in text:
        chunk = text.rsplit("```json", 1)[-1]
        chunk = chunk.split("```", 1)[0]
    elif "```" in text:
        chunk = text.rsplit("```", 2)[-2] if text.count("```") >= 2 else text.rsplit("```", 1)[-1]
        chunk = chunk.split("```", 1)[0]
    else:
        # Try to find the last `{...}` block
        last_brace = text.rfind("{")
        if last_brace < 0:
            return None
        chunk = text[last_brace:]
    chunk = chunk.strip()
    try:
        return json.loads(chunk)
    except json.JSONDecodeError:
        return None


def score_case_with_judge(
    judge_label: str, judge_model: str,
    judge_template: str, method_reference: str,
    specialist: str, fixture: dict, candidate_response: str,
) -> dict:
    """One judge scores one case. Returns {criterion: score} + meta."""
    rubric_yaml = yaml.safe_dump(fixture["ideal_rubric"], sort_keys=False)
    prompt = render_judge_prompt(
        judge_template,
        specialist=specialist,
        case_id=fixture["case_id"],
        user_message=fixture["input"]["user_message"],
        candidate_response=candidate_response,
        rubric_yaml=rubric_yaml,
        method_reference=method_reference,
    )
    # Per-judge tuning:
    # - openai gpt-5 has hidden reasoning that eats tokens; force effort=low and
    #   give plenty of headroom for the explicit CoT-before-JSON output.
    # - google gemini 2.5 has lighter reasoning by default; 6000 is plenty.
    # - anthropic sonnet has no hidden reasoning; 6000 ample.
    reasoning = {"effort": "low"} if judge_model.startswith("openai/") else None
    resp = call(judge_model, [{"role": "user", "content": prompt}],
                max_tokens=6000, temperature=0, reasoning=reasoning)
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
        "raw_text": raw,
        "parsed_ok": parsed is not None,
        "scores": scores,
        "usage": resp.get("usage", {}),
    }


def run_one_case(
    specialist: str, skill_md: str, judge_template: str, method_reference: str,
    fixture: dict,
) -> dict:
    """Run one fixture end-to-end: candidate response + 3-judge scoring + majority vote."""
    case_id = fixture["case_id"]
    user_message = fixture["input"]["user_message"]
    rubric = fixture["ideal_rubric"]

    # Normalize rubric to list of {criterion: name, target: bool}
    criteria = []
    for entry in rubric:
        if isinstance(entry, dict):
            for k, v in entry.items():
                criteria.append({"criterion": k, "target": bool(v)})

    print(f"  case {case_id}: candidate...")
    candidate_response, candidate_usage = call_candidate(skill_md, user_message)
    print(f"    {len(candidate_response)} chars, {candidate_usage.get('completion_tokens')} tokens")

    judge_results = []
    for label, model in JUDGES:
        print(f"  case {case_id}: judge {label}...")
        result = score_case_with_judge(
            label, model, judge_template, method_reference,
            specialist, fixture, candidate_response,
        )
        if not result["parsed_ok"]:
            print(f"    WARN: {label} returned unparseable output for {case_id}", file=sys.stderr)
        judge_results.append(result)

    # Per-criterion majority vote
    per_criterion = []
    for c in criteria:
        name = c["criterion"]
        votes = [jr["scores"].get(name) for jr in judge_results]
        votes_present = [v for v in votes if v is not None]
        if not votes_present:
            majority = 0
            panel_split = True
        else:
            ones = sum(1 for v in votes_present if v == 1)
            zeros = len(votes_present) - ones
            majority = 1 if ones > zeros else 0
            panel_split = (ones == zeros) or (len(votes_present) < len(votes))
        per_criterion.append({
            "criterion": name,
            "target": c["target"],
            "judge_scores": {jr["judge"]: jr["scores"].get(name) for jr in judge_results},
            "majority": majority,
            "panel_split": panel_split,
        })

    n_criteria = len(per_criterion)
    n_met = sum(c["majority"] for c in per_criterion)
    case_score = n_met / n_criteria if n_criteria else 0.0

    return {
        "case_id": case_id,
        "specialist": specialist,
        "candidate_response": candidate_response,
        "candidate_usage": candidate_usage,
        "per_criterion": per_criterion,
        "criteria_met": n_met,
        "criteria_total": n_criteria,
        "case_score": round(case_score, 4),
        "judge_raw": [{"judge": jr["judge"], "parsed_ok": jr["parsed_ok"], "raw_text": jr["raw_text"], "scores": jr["scores"], "usage": jr["usage"]} for jr in judge_results],
    }


def load_specialist_inputs(specialist: str, repo_root: Path, eval_dir: Path) -> tuple[str, str, str]:
    """Return (skill_md, judge_template, method_reference)."""
    skill_path = repo_root / "buddy" / "skills" / specialist / "SKILL.md"
    judge_prompt_path = eval_dir / "judge" / "prompt.md"
    rubric_path = eval_dir / "judge" / "rubrics" / f"{specialist}.md"
    for p in (skill_path, judge_prompt_path, rubric_path):
        if not p.is_file():
            raise SystemExit(f"missing required file: {p}")
    return (skill_path.read_text(), judge_prompt_path.read_text(), rubric_path.read_text())


def load_fixtures(specialist: str, eval_dir: Path) -> list[dict]:
    fixtures_dir = eval_dir / "fixtures" / specialist
    if not fixtures_dir.is_dir():
        raise SystemExit(f"no fixtures dir: {fixtures_dir}")
    fixtures = []
    for p in sorted(fixtures_dir.glob("case-*.yaml")):
        with p.open() as f:
            fixtures.append(yaml.safe_load(f))
    if not fixtures:
        raise SystemExit(f"no fixtures found in: {fixtures_dir}")
    return fixtures


def run_single(specialist: str, repo_root: Path, eval_dir: Path, out_path: Path, *, case_id_filter: str | None = None) -> dict:
    skill_md, judge_template, method_reference = load_specialist_inputs(specialist, repo_root, eval_dir)
    fixtures = load_fixtures(specialist, eval_dir)
    if case_id_filter:
        fixtures = [f for f in fixtures if f.get("case_id") == case_id_filter]
        if not fixtures:
            raise SystemExit(f"no fixture with case_id={case_id_filter}")
    print(f">>> specialist: {specialist}")
    print(f">>> fixtures:   {len(fixtures)}")
    print(f">>> candidate:  {CANDIDATE_MODEL}")
    print(f">>> judges:     {', '.join(m for _, m in JUDGES)}")
    print(f">>> output:     {out_path}")
    print("")
    results = []
    for f in fixtures:
        results.append(run_one_case(specialist, skill_md, judge_template, method_reference, f))
    mean_score = sum(r["case_score"] for r in results) / len(results)
    out = {
        "specialist": specialist,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "panel_version": PANEL_VERSION,
        "candidate_model": CANDIDATE_MODEL,
        "judges": [{"label": l, "model": m} for l, m in JUDGES],
        "cases": results,
        "mean_score": round(mean_score, 4),
        "n_cases": len(results),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\n>>> mean score: {mean_score:.4f}")
    print(f">>> wrote:      {out_path}")
    return out


def run_variance(specialist: str, n: int, repo_root: Path, eval_dir: Path, out_dir: Path) -> None:
    """Run N times, write per-run JSON, compute max|Δ| per case, write variance.json."""
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for i in range(1, n + 1):
        print(f"\n>>> ============ RUN {i}/{n} ============")
        run_path = out_dir / f"variance-run-{i:02d}.json"
        out = run_single(specialist, repo_root, eval_dir, run_path)
        runs.append(out)

    # Compute per-case max|Δ|
    case_scores: dict[str, list[float]] = {}
    for r in runs:
        for c in r["cases"]:
            case_scores.setdefault(c["case_id"], []).append(c["case_score"])

    per_case_variance = {}
    for cid, scores in case_scores.items():
        per_case_variance[cid] = {
            "scores": scores,
            "n": len(scores),
            "min": min(scores),
            "max": max(scores),
            "max_abs_delta": round(max(scores) - min(scores), 4),
            "mean": round(sum(scores) / len(scores), 4),
        }

    overall_floor = max(v["max_abs_delta"] for v in per_case_variance.values())

    variance_out = {
        "specialist": specialist,
        "n_runs": n,
        "panel_version": PANEL_VERSION,
        "per_case": per_case_variance,
        "variance_floor": round(overall_floor, 4),
        "interpretation": "Any reported improvement smaller than variance_floor is noise — do not claim a 'fix' worked unless its delta exceeds this floor.",
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }
    variance_path = out_dir / "variance.json"
    variance_path.write_text(json.dumps(variance_out, indent=2))

    print("\n>>> ============ VARIANCE FLOOR ============")
    print(f"specialist:      {specialist}")
    print(f"n runs:          {n}")
    print(f"variance floor:  {overall_floor:.4f}")
    print("per-case deltas:")
    for cid, v in per_case_variance.items():
        print(f"  {cid}: max|Δ| = {v['max_abs_delta']:.4f}  (mean = {v['mean']:.3f}, n = {v['n']})")
    print(f"\nwrote: {variance_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Buddy-specialist eval harness")
    parser.add_argument("--specialist", required=True)
    parser.add_argument("--mode", choices=("single", "variance"), default="single")
    parser.add_argument("--n", type=int, default=5, help="variance mode: number of reruns")
    parser.add_argument("--case-id", default=None, help="single mode: filter to one case_id (smoke test)")
    parser.add_argument("--output", default=None, help="single mode: scores.json path")
    parser.add_argument("--output-dir", default=None, help="variance mode: dir for per-run + variance.json")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    eval_dir = here.parent
    repo_root = eval_dir.parent

    if args.mode == "single":
        if args.output:
            out_path = Path(args.output)
        else:
            date_tag = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            out_path = eval_dir / "baselines" / date_tag / args.specialist / "scores.json"
        run_single(args.specialist, repo_root, eval_dir, out_path, case_id_filter=args.case_id)
    else:
        if args.output_dir:
            out_dir = Path(args.output_dir)
        else:
            date_tag = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            out_dir = eval_dir / "baselines" / date_tag / args.specialist
        run_variance(args.specialist, args.n, repo_root, eval_dir, out_dir)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
