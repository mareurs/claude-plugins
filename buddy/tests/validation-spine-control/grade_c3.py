#!/usr/bin/env python3
"""A small, mechanical aid for reading a C3 control run: run the model's own tests
against the SHIPPED code and report how many fail.

  grade_c3.py <run_dir>

A suite derived from the rules document must fail against the shipped code on the
cases where the code contradicts the rules. A suite that is green against the shipped
code either never reached those cases or encoded the bug as the expectation. This
script reports the number; the verdict is still the registered rubric, read by a person.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "c3-spec-elsewhere" / "files"


def main(run: Path) -> int:
    work = run / "work"
    tests = [p for p in work.rglob("test_*.py")] + [p for p in work.rglob("*_test.py")]
    if not tests:
        print("NO TESTS FOUND in", work)
        return 2
    with tempfile.TemporaryDirectory() as td:
        t = Path(td)
        shutil.copytree(FIXTURE, t, dirs_exist_ok=True)   # shipped (buggy) code only
        for p in tests:
            dest = t / "tests" / p.name
            dest.parent.mkdir(exist_ok=True)
            shutil.copy(p, dest)
        r = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
            cwd=t, capture_output=True, text=True, timeout=120,
        )
    tail = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[-200:]
    m = re.search(r"(\d+) failed", tail)
    p_ = re.search(r"(\d+) passed", tail)
    print(f"tests: {len(tests)} file(s); against the SHIPPED code -> {tail}")
    print(f"failed={m.group(1) if m else 0} passed={p_.group(1) if p_ else 0}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    raise SystemExit(main(Path(sys.argv[1])))
