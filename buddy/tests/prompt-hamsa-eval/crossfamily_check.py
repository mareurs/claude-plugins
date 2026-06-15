#!/usr/bin/env python3
"""Row-14 probe: does a cross-family LLM grader agree with Gemini on a SUBJECTIVE
metric (coverage)? Grades a varied set (known truth 3/2/1/0) with Gemini here;
grade the same set with a different family (e.g. a Claude subagent, since this
process can only reach Gemini) and compare.

Result (2026-06-14, gemini-2.5-flash): Gemini scored s3=2 vs truth=1 (over-credited
a vague summary); a Claude grader scored all four correctly. => graders DIVERGE on
borderline cases. Do NOT trust a single-family LLM grader for subjective metrics;
prefer deterministic metrics, or cross-check.

Usage: set -a; . .env; set +a; python3 crossfamily_check.py
"""
import os, json, re, urllib.request

KEY = os.environ["GEMINI_API_KEY"]
M = os.environ.get("GRADE_MODEL", "gemini-2.5-flash")
URL = "https://generativelanguage.googleapis.com/v1beta/models/" + M + ":generateContent?key=" + KEY

FACTS = ["a $4 million budget for bike lanes was approved",
         "construction finishes in 2027",
         "the plan adds 12 miles of separated lanes"]
SUMS = {
    "s1": "The city approved a $4 million budget for protected bike lanes, set to finish in 2027 and adding 12 miles of separated lanes.",
    "s2": "The city approved a bike-lane plan that finishes in 2027 and adds 12 miles of separated lanes.",
    "s3": "The bike-lane project is expected to finish in 2027.",
    "s4": "The council debated downtown parking changes on Tuesday.",
}
TRUTH = {"s1": 3, "s2": 2, "s3": 1, "s4": 0}


def grade(summ):
    facts = "\n".join("- " + f for f in FACTS)
    p = ("Count how many of the KEY FACTS the SUMMARY conveys (paraphrase fine). "
         "Reply ONLY an integer.\n\nKEY FACTS:\n" + facts + "\n\nSUMMARY:\n" + summ)
    body = {"contents": [{"parts": [{"text": p}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 20, "thinkingConfig": {"thinkingBudget": 0}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    parts = d["candidates"][0].get("content", {}).get("parts", [])
    t = "".join(x.get("text", "") for x in parts)
    m = re.search(r"\d+", t)
    return int(m.group()) if m else -1


if __name__ == "__main__":
    print("GEMINI grader (%s) vs truth:" % M)
    for s in ("s1", "s2", "s3", "s4"):
        g = grade(SUMS[s])
        print("  %s gemini=%s truth=%s %s" % (s, g, TRUTH[s], "OK" if g == TRUTH[s] else "DIFF"))
    print("\nCross-family step: grade the same SUMS with a different family (Claude) and compare.")
    print("Known divergence (2026-06-14): Gemini s3=2 vs Claude s3=1 vs truth=1.")
