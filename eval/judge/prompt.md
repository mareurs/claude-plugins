# Buddy-Specialist Judge Prompt

This is the cross-family LLM-judge prompt used by every PoLL panel member to score
a buddy specialist's response against a per-case rubric. The same prompt is used
for every specialist; rubric semantics come from `rubrics/<specialist>.md`.

## Prompt template

```
You are evaluating an AI persona named {{specialist}} against a per-case rubric.

[INPUTS]
- specialist: {{specialist}}
- case_id: {{case_id}}
- user_message: |
    {{user_message}}
- candidate_response: |
    {{candidate_response}}
- rubric: a list of boolean criteria; see [CRITERIA]
- specialist_method_reference: |
    {{specialist_method_reference}}     # paste from rubrics/<specialist>.md

[METHOD — apply in order; do not skip]

1. Read the user_message and candidate_response as a stranger — no project context,
   no charity for the persona's style. Style is irrelevant; rubric semantics is
   everything.

2. For each rubric criterion, in the order listed:
   a. Quote the specific span of candidate_response that addresses the criterion
      (verbatim, with surrounding context if needed for meaning).
   b. If no relevant span exists, write exactly: NO EVIDENCE FOUND
   c. In one sentence, reason about whether the span satisfies the criterion.
   d. Score 0 (not met) or 1 (met).

3. Do NOT score by inference, charity, or stylistic alignment. Evidence must be
   in the response. "The persona probably meant this" is not evidence.

4. For "avoids_X: true" criteria: score 1 iff the response demonstrably avoided X
   (e.g. explicitly named the trap, declined the requested action, named a better
   alternative). Score 0 if the response did X.

5. For "references_method_N_or_heuristic_N" criteria: score 1 iff the response
   cites a specific Method step, Heuristic, or Reaction by number or by its
   bolded title. A bare paraphrase without citation scores 0.

[CONSTRAINTS]

- Holistic "overall good" scoring is forbidden. Always decompose.
- Chain-of-thought reasoning is required BEFORE the final JSON.
- This judgment may be run twice with reversed candidate-position. Be
  deterministic — the same response gets the same score regardless of position.
  If you detect that your judgment would change under position swap, set
  `position_unstable: true` and explain in `position_note`.
- Do not penalize length, formatting, prose register, or persona voice. Score
  rubric semantics only.
- Do not invent rubric criteria not present in the input. Score only what is given.

[OUTPUT FORMAT]

After your CoT reasoning, output a single fenced JSON block:

```json
{
  "case_id": "<case_id>",
  "specialist": "<specialist>",
  "rubric_scores": [
    {
      "criterion": "<criterion_name>",
      "evidence": "<quoted span or NO EVIDENCE FOUND>",
      "reasoning": "<one sentence>",
      "score": 0
    }
  ],
  "total": "N / M",
  "position_unstable": false,
  "position_note": ""
}
```

The JSON block must be the LAST thing in your response. Anything after it is
discarded by the harness.
```

## Notes on this prompt

### Decompose, not holistic

Holistic prompts ("rate this 1–5 for faithfulness") invite the judge to confabulate
a global feel. Decomposed prompts produce honest, higher-variance scores.

Source: Min et al., *FActScore*, EMNLP 2023; Es et al., *RAGAS*, EACL 2024.

### CoT before JSON

Forcing explicit reasoning before the final structured output reduces self-preference
bias. The judge cannot quietly anchor on familiarity with its own outputs once it
has committed reasoning to text.

Source: Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*,
NeurIPS 2023.

### Position-swap

Position bias: one study found 48.4% of pairwise verdicts reverse simply by swapping
response order. The harness runs each pair in both orders; the judge prompt asks
the judge to flag any position-dependence it can introspect on.

Source: Wang et al., *Large Language Models are not Fair Evaluators*, 2023.

### NO EVIDENCE FOUND

Explicit string for the absence case prevents the judge from scoring 1 by silent
inference. The harness can grep for `NO EVIDENCE FOUND` lines as a sanity check
on calibration runs.

### "avoids_X: true" interpretation

The rubric files use `avoids_X: true` as the canonical form for must-not-do criteria.
Inverting the polarity (using `does_X: false`) is forbidden — the judge prompt is
written assuming all targets are 1, and mixed polarity is a known source of
scoring instability.

## Variables the harness fills in

| Variable | Source |
|---|---|
| `{{specialist}}` | fixture's `specialist:` field |
| `{{case_id}}` | fixture's `case_id:` field |
| `{{user_message}}` | fixture's `input.user_message` |
| `{{candidate_response}}` | generator output for this case |
| `{{specialist_method_reference}}` | contents of `rubrics/<specialist>.md` § Method/Heuristic/Reaction reference |

## Position-swap protocol

The harness runs each (case, candidate) pair through the judge **twice**:

- Run A: positions as given
- Run B: candidate_response and user_message swapped where applicable

Verdict reversal between runs A and B is logged. The harness flags any case with
≥ 1 reversal across the panel as `position_unstable: true` in the final scores.
