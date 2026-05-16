## Superseded by v2 (numerically equal, methodologically inferior)

This baseline was frozen 2026-05-16 with a known parser bug in
`eval/scripts/harness.py::parse_judge_output` (fixed in commit `ac9ae8a`).

The bug: when an openai/gpt-5 judge response was bare JSON (no `\`\`\`json`
fence, no CoT preamble — both of which the prompt requests but gpt-5
intermittently skips), the no-fence fallback used `rfind('{')`. This picks
the LAST opening brace in the text, which is an inner `rubric_scores[i]`
object, not the outermost JSON. The fragment fails to parse → judge dropped
→ panel degrades to 2 judges → tied criteria default to not-met.

**Effect on this baseline (measured empirically)**: openai parsed_ok rate
was 12/15 (80%); v2 with the fix is 14/15 (93%). But the v1 numerical
results are identical to v2:

| | Floor | case-01 mean / Δ | case-02 mean / Δ | case-03 mean / Δ |
|---|---|---|---|---|
| v1 (buggy parser) | 0.200 | 0.880 / 0.200 | 1.000 / 0.000 | 1.000 / 0.000 |
| v2 (fixed parser) | 0.200 | 0.880 / 0.200 | 1.000 / 0.000 | 1.000 / 0.000 |

The case-01 spread of 0.20 is genuine judge disagreement on one of the 5
criteria, not a parser artifact. The 3 v1 openai parse-failures fell on
cells where anthropic+google agreed, so the panel still resolved correctly
even with openai dropped.

**Effect on κ_vs_strong_panel (= 1.000)**: both panels had the same bug
pre-`ac9ae8a`, so paired-cell judgments were dropped symmetrically.
κ is computed only on cells both panels scored, so the value should be
unchanged. v2 inherits the κ value from v1's calibration run; re-verification
deferred — would require fresh `gold-label.py` run with fixed parser
(~$2, ~10min) and the symmetry argument makes the value unlikely to move.

**Use v2** for all future regression detection: `eval/baselines/frozen/ml-training-takin@v2/`.

This v1 directory is preserved for forensic comparison.
