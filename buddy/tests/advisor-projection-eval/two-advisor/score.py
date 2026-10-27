#!/usr/bin/env python3
"""Score the two-advisor projection eval.

  score.py <results_dir>            mechanical scores per arm
  score.py <results_dir> --blind    write blind/R*.txt and blind-key.tsv
  score.py --selftest               check the scorer against cases it must separate

Only VALID responses are scored. A missing, empty or errored response is INVALID and is
reported separately: AMENDMENT-2 of the one-advisor eval is why (a scorer that reads
"no data" as "no field" biases the result).
"""
import hashlib
import sys
from pathlib import Path

RETAIN_ORIG = ["**Contract:**", "**Mutation-survival:**", "**Boundaries covered:**"]
# AMENDMENT-1: the original list missed a response that kept the primary's contract in
# a slightly different shape. These are all exclusive to the primary's Test Format.
# `**Confidence:**` is shared by every format and is deliberately not a marker.
RETAIN = RETAIN_ORIG + ["**Properties:**", "**Isolation:**", "**Pyramid level:**", "**Open gaps:**"]
VERB = {
    "security": ["**Severity:**", "**Exploit sketch:**", "**Category:**"],
    "architecture": ["**Decision:**", "**Alternatives considered:**", "**Change scenarios absorbed:**"],
}
ADVISORS = ["security-ibex", "architecture-snow-lion", "planning-crane", "refactoring-yak"]


def score_text(text: str) -> dict:
    """Mechanical observables for one response. Empty text is INVALID, not 'no fields'."""
    if not text.strip():
        return {"invalid": True}
    return {
        "invalid": False,
        "retain": any(m in text for m in RETAIN),
        "retain_orig": any(m in text for m in RETAIN_ORIG),
        "cites": {a: a in text for a in ADVISORS},
        "verbatim": {k: any(m in text for m in v) for k, v in VERB.items()},
    }


def load(results: Path) -> dict:
    arms = {}
    for d in sorted(p for p in results.iterdir() if p.is_dir() and p.name != "blind"):
        runs = {}
        for f in sorted(d.glob("run-*.txt"), key=lambda p: int(p.stem.split("-")[1])):
            runs[f.stem] = score_text(f.read_text())
        invalid = len(list(d.glob("attempt-*.invalid"))) + sum(1 for r in runs.values() if r["invalid"])
        arms[d.name] = {"runs": {k: v for k, v in runs.items() if not v["invalid"]}, "invalid": invalid}
    return arms


def report(results: Path) -> None:
    for arm, data in load(results).items():
        runs = list(data["runs"].values())
        n = len(runs)
        print(f"{arm}: valid n={n}, invalid={data['invalid']}")
        if not n:
            continue
        print(f"  RETAIN {sum(r['retain'] for r in runs)}/{n}  (original markers: {sum(r['retain_orig'] for r in runs)}/{n})")
        for a in ADVISORS:
            print(f"  cites {a}: {sum(r['cites'][a] for r in runs)}/{n}")
        for k in VERB:
            print(f"  verbatim {k} (non-gating): {sum(r['verbatim'][k] for r in runs)}/{n}")


def blind(results: Path) -> None:
    """Deterministic content-hash shuffle; the key is written OUTSIDE the blind dir."""
    items = []
    for d in sorted(p for p in results.iterdir() if p.is_dir() and p.name != "blind"):
        for f in sorted(d.glob("run-*.txt")):
            text = f.read_text()
            if text.strip():
                items.append((hashlib.sha256(text.encode()).hexdigest(), d.name, f.stem, text))
    items.sort()
    out = results / "blind"
    out.mkdir(exist_ok=True)
    key = ["label\tarm\trun"]
    for i, (_, arm, run, text) in enumerate(items, 1):
        label = f"R{i:02d}"
        (out / f"{label}.txt").write_text(text)
        key.append(f"{label}\t{arm}\t{run}")
    (results / "blind-key.tsv").write_text("\n".join(key) + "\n")
    print(f"wrote {len(items)} blind responses to {out}; key at {results / 'blind-key.tsv'} (do not open)")


def selftest() -> int:
    cases = [
        ("retain fields present", "**Contract:** x\n**Mutation-survival:** y", lambda s: s["retain"] is True),
        ("answered, fields omitted", "Here is some prose review only.", lambda s: s["invalid"] is False and s["retain"] is False),
        ("empty response is INVALID, not 'no fields'", "", lambda s: s["invalid"] is True),
        ("whitespace-only is INVALID", "  \n\t", lambda s: s["invalid"] is True),
        ("cites ibex only", "ask security-ibex about it", lambda s: s["cites"]["security-ibex"] and not s["cites"]["architecture-snow-lion"]),
        ("cites architecture only", "see architecture-snow-lion", lambda s: s["cites"]["architecture-snow-lion"] and not s["cites"]["security-ibex"]),
        ("security verbatim", "**Severity:** HIGH", lambda s: s["verbatim"]["security"] and not s["verbatim"]["architecture"]),
        ("architecture verbatim", "**Decision:** split it", lambda s: s["verbatim"]["architecture"] and not s["verbatim"]["security"]),
        ("a near-miss does not match", "Contract: x (no bold)", lambda s: s["retain"] is False),
        ("run-5 shape: contract kept in other fields (AMENDMENT-1)", "**Properties:** x\n**Isolation:** y\n**Pyramid level:** unit\n**Open gaps:** z", lambda s: s["retain"] is True and s["retain_orig"] is False),
        ("a shared field alone is not RETAIN", "**Confidence:** high", lambda s: s["retain"] is False),
        ("an ADR-shaped response is not RETAIN", "**Decision:** split\n**Context:** c\n**Alternatives considered:** a\n**Confidence:** high", lambda s: s["retain"] is False and s["verbatim"]["architecture"] is True),
    ]
    bad = 0
    for name, text, check in cases:
        ok = bool(check(score_text(text)))
        print(("PASS" if ok else "FAIL") + f": {name}")
        bad += 0 if ok else 1
    print(f"{len(cases) - bad}/{len(cases)} pass")
    return 1 if bad else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        raise SystemExit(selftest())
    if len(sys.argv) == 3 and sys.argv[2] == "--blind":
        blind(Path(sys.argv[1]))
    elif len(sys.argv) == 2:
        report(Path(sys.argv[1]))
    else:
        raise SystemExit(__doc__)
