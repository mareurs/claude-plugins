"""Unit tests for eval/scripts/harness.py::parse_judge_output.

Regression cover for 2026-05-16 bug: parse_judge_output silently returned
None on bare-JSON judge outputs (no ```json fence, no CoT preamble — the
shape gpt-5 frequently emits despite the prompt asking for CoT-first).
The no-fence fallback used rfind('{') which selected an inner
rubric_scores[i] object, producing a JSON fragment that fails to parse.

Effect at the time: openai judge silently dropped on roughly 1/3 of
(case, run) cells; panel degraded to 2 judges; tied criteria defaulted
to not-met; case-03 baseline mean appeared to drop 1.0 -> 0.833 in drift
control, looking like a regression that was actually a parser bug.

Run with:
    pytest tests/test_harness_parse.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
HARNESS_PY = REPO_ROOT / "eval" / "scripts" / "harness.py"

sys.path.insert(0, str(HARNESS_PY.parent))
import harness  # noqa: E402


BARE_JSON_FROM_GPT5 = """{
  "case_id": "case-02",
  "specialist": "ml-training-takin",
  "rubric_scores": [
    {
      "criterion": "names_train_serve_skew",
      "evidence": "Train-serve skew. Almost always.",
      "reasoning": "Explicitly names train-serve skew.",
      "score": 1
    },
    {
      "criterion": "suggests_byte_identical_parity_test",
      "evidence": "Run it through both paths and capture the tensor at the model input...",
      "reasoning": "Prescribes a parity test with equality assertion.",
      "score": 1
    }
  ],
  "total": "2 / 2",
  "position_unstable": false,
  "position_note": ""
}"""

FENCED_JSON = '''Reasoning: I'll walk through each criterion.

1. names_train_serve_skew: candidate says "Train-serve skew." Met.
2. suggests_byte_identical_parity_test: candidate prescribes parity test. Met.

```json
{
  "case_id": "case-02",
  "specialist": "ml-training-takin",
  "rubric_scores": [
    {"criterion": "names_train_serve_skew", "score": 1},
    {"criterion": "suggests_byte_identical_parity_test", "score": 1}
  ],
  "total": "2 / 2"
}
```'''

FENCED_UNTAGGED = '''CoT here.

```
{
  "case_id": "x",
  "rubric_scores": [{"criterion": "c1", "score": 1}],
  "total": "1 / 1"
}
```'''


def test_bare_json_no_preamble_no_fence_parses():
    """gpt-5 frequently emits bare JSON. Regression cover for 2026-05-16 bug."""
    parsed = harness.parse_judge_output(BARE_JSON_FROM_GPT5)
    assert parsed is not None, "bare-JSON input must parse (was silently dropped pre-fix)"
    assert parsed["case_id"] == "case-02"
    assert len(parsed["rubric_scores"]) == 2
    assert all(r["score"] == 1 for r in parsed["rubric_scores"])


def test_fenced_json_block_parses():
    """Anthropic/Google honor the CoT-then-fenced-JSON instruction."""
    parsed = harness.parse_judge_output(FENCED_JSON)
    assert parsed is not None
    assert parsed["case_id"] == "case-02"
    assert len(parsed["rubric_scores"]) == 2


def test_fenced_untagged_block_parses():
    """Some models emit ``` without the json tag."""
    parsed = harness.parse_judge_output(FENCED_UNTAGGED)
    assert parsed is not None
    assert parsed["case_id"] == "x"


def test_garbage_returns_none():
    assert harness.parse_judge_output("not json at all, sorry") is None
    assert harness.parse_judge_output("") is None


def test_bare_json_with_leading_whitespace():
    """Strip-then-startswith-{ check must tolerate leading whitespace."""
    parsed = harness.parse_judge_output("\n\n  " + BARE_JSON_FROM_GPT5 + "\n")
    assert parsed is not None
    assert parsed["case_id"] == "case-02"


def test_real_captured_raw_text_if_available():
    """If diagnostic run artifacts are present, re-parse them with the fix.

    Skip cleanly if the artifact has been pruned — this is a forensic
    assertion, not a contract.
    """
    artifact = REPO_ROOT / "eval" / "baselines" / "2026-05-16" / "ml-training-takin" / "variance-run-01.json"
    if not artifact.exists():
        pytest.skip("diagnostic artifact pruned")
    with artifact.open() as f:
        data = json.load(f)
    openai_raws = []
    for case in data["cases"]:
        for jr in case["judge_raw"]:
            if jr["judge"] == "openai" and jr.get("raw_text"):
                openai_raws.append((case["case_id"], jr["raw_text"]))
    if not openai_raws:
        pytest.skip("no openai raw_text in artifact (predates raw_text-capture fix)")
    for case_id, raw in openai_raws:
        parsed = harness.parse_judge_output(raw)
        assert parsed is not None, f"openai raw_text for {case_id} failed to parse"
        assert "rubric_scores" in parsed
