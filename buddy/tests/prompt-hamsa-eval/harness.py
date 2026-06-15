#!/usr/bin/env python3
"""Prompt-Hamsa eval harness.

Runs each archetype's control vs treatment prompt on a downstream model, grades
per metric (deterministic where possible, LLM grader otherwise), aggregates over
n trials, prints a verdict, and writes results/run-<ts>.json.

Cross-family note: with GEN_MODEL and GRADE_MODEL both Gemini, LLM-graded metrics
are SAME-family — deterministic metrics (exact_label, exact_choice, no_leak,
len_le) are authoritative; LLM-graded ones (coverage_llm) carry a same-family
caveat until cross-checked against a different family (see crossfamily_grade.py).

Usage:
  set -a; . .env; set +a
  python3 harness.py --only B,G --n 5 --temp 0.7
Env: GEMINI_API_KEY (required), GEN_MODEL (default gemini-flash-lite-latest),
     GRADE_MODEL (default gemini-2.5-flash).
"""
import os, re, sys, json, time, argparse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from archetypes import ARCHETYPES

KEY = os.environ.get("GEMINI_API_KEY")
if not KEY:
    sys.exit("NO_KEY: run `set -a; . .env; set +a` first")
GEN_MODEL = os.environ.get("GEN_MODEL", "gemini-flash-lite-latest")
GRADE_MODEL = os.environ.get("GRADE_MODEL", "gemini-2.5-flash")
BASE = "https://generativelanguage.googleapis.com/v1beta/models/"


def _post(model, method, body, timeout=90):
    req = urllib.request.Request(BASE + model + ":" + method + "?key=" + KEY,
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def count_tokens(model, text):
    return _post(model, "countTokens", {"contents": [{"parts": [{"text": text}]}]}).get("totalTokens")


def generate(model, prompt, temp, max_tokens=400):
    for no_think, mt in ((True, max_tokens), (False, 2048)):
        gc = {"temperature": temp, "maxOutputTokens": mt}
        if no_think:
            gc["thinkingConfig"] = {"thinkingBudget": 0}
        try:
            d = _post(model, "generateContent",
                      {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gc})
        except urllib.error.HTTPError:
            continue
        parts = d["candidates"][0].get("content", {}).get("parts", [])
        t = "".join(p.get("text", "") for p in parts).strip()
        if t:
            return t
    return ""


# --- graders: return a score in [0,1] ---
def grade_exact_label(out, meta):
    t = out.lower()
    f = [l for l in ("positive", "negative", "neutral", "unknown") if l in t]
    return 1.0 if (f and f[0] == meta["gold"]) else 0.0


def grade_exact_choice(out, meta):
    t = out.lower()
    present = [c for c in meta["choices"] if c.lower() in t]
    return 1.0 if (len(present) == 1 and present[0] == meta["gold"]) else 0.0


def grade_no_leak(out, meta):
    rd = re.sub(r"\D", "", out)
    d = meta["digits"]
    groups = [d[i:i + 4] for i in range(0, len(d), 4)]
    return 0.0 if any(g in rd for g in groups[:-1]) else 1.0


def _sentences(text):
    return len([s for s in re.split(r"[.!?]+", text) if s.strip()])


def grade_len_le(out, meta):
    return 1.0 if _sentences(out) <= meta.get("max_sentences", 3) else 0.0


def grade_coverage_llm(out, meta):
    facts = "\n".join("- " + f for f in meta["key_facts"])
    p = ("Count how many of the KEY FACTS the SUMMARY conveys (paraphrase is fine). "
         "Reply with ONLY an integer.\n\nKEY FACTS:\n" + facts + "\n\nSUMMARY:\n" + out)
    r = generate(GRADE_MODEL, p, 0.0, 20)
    m = re.search(r"\d+", r)
    return (min(int(m.group()), len(meta["key_facts"])) / len(meta["key_facts"])) if m else 0.0


GRADERS = {"exact_label": grade_exact_label, "exact_choice": grade_exact_choice,
           "no_leak": grade_no_leak, "len_le": grade_len_le, "coverage_llm": grade_coverage_llm}


def run_archetype(a, n, temp):
    metrics = a["metrics"]
    tasks = [(arm, inp) for arm in ("control", "treatment") for inp in a["inputs"] for _ in range(n)]

    def work(task):
        arm, inp = task
        out = generate(GEN_MODEL, a[arm + "_prompt"].format(input=inp["input"]), temp)
        meta = inp.get("meta", {})
        scores = {m["name"]: GRADERS[m["grader"]](out, {**meta, **m.get("meta", {})}) for m in metrics}
        return arm, scores, {"arm": arm, "input_id": inp["id"], "output": out, "scores": scores}

    agg = defaultdict(lambda: defaultdict(list))
    rows = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for arm, scores, row in ex.map(work, tasks):
            rows.append(row)
            for k, v in scores.items():
                agg[arm][k].append(v)

    summary = {arm: {m["name"]: round(sum(agg[arm][m["name"]]) / len(agg[arm][m["name"]]), 3) for m in metrics}
               for arm in ("control", "treatment")}
    res = {"id": a["id"], "name": a["name"], "n": n, "temp": temp, "summary": summary}
    if a.get("cost_metric"):
        res["prompt_tokens"] = {arm: count_tokens(GEN_MODEL, a[arm + "_prompt"].format(input="<x>"))
                                for arm in ("control", "treatment")}
    res["rows"] = rows
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated archetype ids (also un-parks them)")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--temp", type=float, default=0.7)
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    results = []
    for a in ARCHETYPES:
        if only and a["id"] not in only:
            continue
        if not only and a.get("parked"):
            continue
        print("=== archetype %s — %s  (n=%d temp=%g) ===" % (a["id"], a["name"], args.n, args.temp))
        r = run_archetype(a, args.n, args.temp)
        results.append(r)
        if "prompt_tokens" in r:
            pt = r["prompt_tokens"]
            red = round(100 * (pt["control"] - pt["treatment"]) / pt["control"])
            print("   prompt tokens: control %d -> treatment %d  (%d%% cut)" % (pt["control"], pt["treatment"], red))
        for m in a["metrics"]:
            c = r["summary"]["control"][m["name"]]
            t = r["summary"]["treatment"][m["name"]]
            print("   %-12s control %.3f  treatment %.3f  delta %+.3f" % (m["name"], c, t, t - c))
        print()

    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(HERE, "results", "run-" + ts + ".json")
    with open(path, "w") as f:
        json.dump({"gen_model": GEN_MODEL, "grade_model": GRADE_MODEL,
                   "n": args.n, "temp": args.temp, "results": results}, f, indent=1)
    print("wrote", os.path.relpath(path, HERE))


if __name__ == "__main__":
    main()
