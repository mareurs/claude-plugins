#!/usr/bin/env python3
"""Blind the spine A/B responses for scoring.

  blind_ab.py <results_dir>

For every valid run of every arm under <results_dir> it writes one review file,
<results_dir>/blind/R<nn>.txt, holding the final message and then the test file(s) the run
produced. The order is a deterministic content-hash shuffle, so it does not depend on the
arm or the run number. The key (label -> arm, run) goes to <results_dir>/blind-key.tsv,
OUTSIDE the blind directory, and is not opened until the last score is recorded.

It also prints how many responses name the skill, because that reveals the arm and the
reader should know how blind the read really was.
"""
import hashlib
import re
import sys
from pathlib import Path

SKILL_WORDS = re.compile(r"validation[- ]spine|the spine|skill", re.I)


def main(results: Path) -> None:
    items = []
    for arm in sorted(p for p in results.iterdir() if p.is_dir() and p.name not in ("blind", "pilot")):
        for run in sorted(arm.glob("run-*")):
            msg = (run / "result.txt").read_text()
            tests = sorted(
                p for p in (run / "work").rglob("*.py")
                if p.name.startswith("test_") or p.name.endswith("_test.py")
            )
            body = msg + "\n\n=== TEST FILE(S) ===\n"
            for t in tests:
                body += f"\n--- {t.name} ---\n{t.read_text()}\n"
            items.append((hashlib.sha256(body.encode()).hexdigest(), arm.name, run.name, body, msg))
    items.sort()
    out = results / "blind"
    out.mkdir(exist_ok=True)
    key = ["label\tarm\trun"]
    named = 0
    for i, (_, arm, run, body, msg) in enumerate(items, 1):
        label = f"R{i:02d}"
        (out / f"{label}.txt").write_text(body)
        key.append(f"{label}\t{arm}\t{run}")
        named += bool(SKILL_WORDS.search(msg))
    (results / "blind-key.tsv").write_text("\n".join(key) + "\n")
    print(f"wrote {len(items)} blind files to {out}; key at {results / 'blind-key.tsv'} (do not open)")
    print(f"{named} of {len(items)} final messages mention a skill or the spine (these reveal their arm)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
