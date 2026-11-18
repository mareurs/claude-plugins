#!/usr/bin/env python3
"""Build the three arms of the two-advisor projection eval.

Each arm's payload is the real `build_payload` output from the shipped assembler
(buddy/scripts/summon_bootstrap.py), not a hand-written approximation. The only thing
this script does by hand is add an `advisors:` line to a COPY of the primary's
frontmatter, which is exactly what a real specialist would declare.

Usage: make_arms.py <out_dir> [stimulus.md]
Defaults to ../stimulus.md. Writes <out_dir>/<arm>/prompt.txt and <out_dir>/manifest.tsv.
"""
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]  # buddy/tests/advisor-projection-eval/two-advisor -> repo root
sys.path.insert(0, str(ROOT / "buddy" / "scripts"))
import summon_bootstrap as sb  # noqa: E402

PRIMARY = "testing-snow-leopard"
ARMS = {
    "B1-primary-alone": [],
    "B2-two-relevant": ["security-ibex", "architecture-snow-lion"],
    "B3-two-irrelevant": ["planning-crane", "refactoring-yak"],
}


def stimulus(path: Path) -> str:
    text = path.read_text()
    # The file is a short intro, a line of '---', then the task. Take what follows.
    return text.split("\n---\n", 1)[1].strip()


def with_advisors(raw: str, advisors: list[str]) -> str:
    """Add `advisors: [...]` to the frontmatter of a copy of the primary."""
    if not advisors:
        return raw
    line = "advisors: [" + ", ".join(advisors) + "]"
    # Insert just before the closing '---' of the frontmatter block.
    m = re.match(r"^(---\n.*?\n)(---\n)", raw, flags=re.S)
    if not m:
        raise SystemExit("primary SKILL.md has no frontmatter block")
    return m.group(1) + line + "\n" + m.group(2) + raw[m.end():]


def main(out: Path, stim: Path) -> None:
    index = sb.discover(Path("/nonexistent-project-root"))
    primary_dir = index[PRIMARY][1]
    raw = (primary_dir / "SKILL.md").read_text()
    task = stimulus(stim)
    out.mkdir(parents=True, exist_ok=True)
    rows = ["arm\tpayload_chars\tprompt_chars\tadvisors"]
    for arm, advisors in ARMS.items():
        with tempfile.TemporaryDirectory() as td:
            skill_dir = Path(td) / PRIMARY
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(with_advisors(raw, advisors))
            payload = sb.build_payload(
                PRIMARY, "builtin", skill_dir, None, Path("/nonexistent-project-root")
            )
        if payload is None:
            raise SystemExit(f"build_payload returned None for {arm}")
        for adv in advisors:
            # A silent drop would make the arm a lie: fail loudly if the advisor is absent.
            if f"— advisor: {adv}" not in payload:
                raise SystemExit(f"{arm}: advisor {adv} is not in the payload")
        prompt = payload + "\n\n---\n\n" + task + "\n"
        d = out / arm
        d.mkdir(exist_ok=True)
        (d / "prompt.txt").write_text(prompt)
        rows.append(f"{arm}\t{len(payload)}\t{len(prompt)}\t{','.join(advisors) or '-'}")
    (out / "manifest.tsv").write_text("\n".join(rows) + "\n")
    print("\n".join(rows))


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) == 3 else HERE.parent / "stimulus.md")
