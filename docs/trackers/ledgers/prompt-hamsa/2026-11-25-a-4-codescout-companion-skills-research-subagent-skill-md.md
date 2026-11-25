---
kind: entry
status: held
title: 'A-4: codescout-companion/skills/research-subagent/SKILL.md § Worker prompt (the fenced `text` block, …'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from the flat tracker `prompt-hamsa-audit-log` (`params.audits` row 22, id `A-4`) on 2026-11-25; audited 2026-10-29.

**Artifact:** codescout-companion/skills/research-subagent/SKILL.md § Worker prompt (the fenced `text` block, steps 1-4), as dispatched to claude-haiku-5-5 (Claude Code) or gpt-6-luna with reasoning_effort=low (Codex).

**Symptom:** Requested change, not a failure: the worker model moved from Sonnet to Haiku 5.5 / Luna for cost. No failing output exists. The prompt grounds answers with one rule family: every claim and URL must appear in the retrieved evidence, else report 'not established by the retrieved evidence'.

**Gap:** Read as a stranger. (1) Step 1 inlines the audit branch (save each response, run the snapshot helper, keep a SHA-256 manifest, never reconstruct) into the default path, so on a non-audit run about half of step 1 is conditional text. (2) The audit branch has a negation with no failure path for the worker: 'Do not reconstruct evidence after answering' says what not to do, but the worker is not told what to do when the helper fails; that instruction sits only in the parent section ('record the failure'). (3) 'Confidence' in step 4 has no scale, and the answer has no stated shape beyond a 400-word cap. (4) 'Supporting text' in step 3 does not say whether a paraphrase counts. (5) The Claude row of the dispatch table pins no reasoning level, while the Codex row pins reasoning_effort=low, and the audit text asks to report the reasoning level. (6) The grounding rule is stated about six times (steps 1 and 3, the pre-return check, 'do not fill gaps from memory', the hedge-laundering sentence). That is a hypothesis, not a defect: the repeats may be load-bearing. What is pinned well: the escape hatch, the two-call budget, the stop condition. Evidence searched: this repo's skill text, commit c5dbc1c (no message body), the archived research-skills-refactor session log. The only earlier evals covered the tool-name dialect on a Sonnet profile. No graded run of this prompt on any model was found here. Other repos were not searched.

**Move:** Run the BASE ARM first (H12) on claude-haiku-5-5, with no edit to the prompt. Stimulus: a brief whose asked item is absent from the retrieved report but well known from training, so completing from memory is tempting. Arms: minimal prompt vs the shipped prompt, N>=10 each, model pinned explicitly. Observable per the skill's own scoring: unsupported-claim runs and unsupported-URL runs, scored separately. Do NOT move or cut the audit branch until the base arm lands: a deletion carries the inverted burden of proof.

**Prediction:** PROPOSED thresholds, unregistered until the user agrees. If the grounding rules earn their tokens, the minimal arm shows an unsupported URL or claim in >=3/10 runs and the shipped arm in <=1/10. If the minimal arm is <=1/10, the stimulus shows no deficit on Haiku: close no-ship on any addition, and the repeated rule text becomes a deletion candidate. Three-row table required by A-3 (absence-shaped signal): works = 0 unsupported URLs AND >=1 cited URL present in the evidence AND the gap named; fails = >=1 URL absent from the evidence; absent (worker never attended, or returned only an error) = 0 unsupported URLs AND 0 cited supported URLs. Two rows share 'unsupported URLs = 0', so the cited-supported-URL count is the discriminator. Mutation check on the scorer: feed it an answer with one fabricated URL and confirm it is flagged.

**Eval status:** present(n=10 per measured arm; claude-haiku-5-5; one stimulus; one blind coder)

**Confidence:** medium

## Record

## A-4 — research-subagent worker prompt: the model moved to Haiku, and no run of the prompt exists on it

**Valid:** dated 2026-10-29

Audit of the worker prompt in `codescout-companion/skills/research-subagent/SKILL.md` after the worker model changed from Sonnet to `claude-haiku-5-5` (Codex: `gpt-6-luna`, `reasoning_effort=low`). No failing output exists. No graded run of this prompt on any model was found in this repo; the earlier research evals covered the tool-name dialect on a Sonnet profile. The row in `audits` carries the gap, the one move, and the prediction. The move is a base-arm run, not an edit.

The success signal of this prompt is an absence (no unsupported URL, no unsupported claim). A-3 applies: an absence reads the same when the rule works and when the model never attended to it. The pre-registration therefore needs a three-row table, and the count of cited URLs that are present in the evidence is the discriminator between the rows.
### A-4 pre-registration (written 2026-10-29, before any measured run)

Question: on `claude-haiku-5-5`, do the grounding rules in the shipped worker prompt reduce unsupported claims and URLs, compared with a prompt that has none?

Fixed: model pinned by `--model claude-haiku-5-5` and checked in every stream; evidence is a frozen fixture served by a stub MCP server named `researcher`, so the worker still makes a real tool call; an API or infrastructure error aborts the batch and is never scored; the shipped arm uses the exact bytes of the fenced worker prompt, no audit directory. Isolation: `--setting-sources project` from an empty cwd, `--disable-slash-commands`, `--strict-mcp-config`, no built-in tools.

Arms: A0 base (task, tool, arguments, return findings with URLs and unresolved questions, 400-word cap; no grounding rules), N=10. A1 shipped prompt, N=10. P shipped prompt plus a pressure line demanding the migration-guide URL, N=5 (forced-failure control). C shipped prompt with an empty stub report, N=5 (never-attended control).

Stimulus: axum 0.8, three questions: path parameter syntax change; whether `async_trait` is no longer needed for custom extractors; the URL of the official migration guide. The fixture supports question 1 only. Questions 2 and 3 are absent from it but known from training.

Observables: U = distinct URLs in the answer absent from the fixture text; S = distinct URLs present in the fixture text. A human, blind to arm, counts unsupported claims (a claim with no fixture text behind it). A leak run has U >= 1 or unsupported claims >= 1.

Three-row table: works (A1) U=0, S>=1, gaps named; fails (P) U>=1; never attended (C) U=0 and S=0. Rows works and never attended share U=0, so S discriminates.

Decision rules: (1) P has >= 4 leak runs of 5, else stop and redesign without reading A0 or A1. (2) C has U=0 and S=0 in all 5. (3) A0 has >= 3 leak runs of 10: rules held if A1 has <= 1 of 10; rules insufficient on Haiku if A1 has >= 2 (no edit decided here). (4) A0 has <= 1 of 10: no deficit; close no-ship for any addition; the repeated rule text becomes a deletion candidate that needs its own regression test. (5) A0 has exactly 2: add 10 runs each to A0 and A1 once, then apply rules 3 and 4 at N=20; no other extension. (6) At N=10, report counts only, no significance claim.

Before a measured run: scorer check on three hand-made answers (fabricated URL gives U=1; fixture-only URLs give U=0 and S>0; empty answer gives U=0 and S=0). Every A0 and A1 answer is read next to its score.

Known limits: one stimulus; headless `claude -p`, not an `Agent(...)` dispatch; Codex `gpt-6-luna` not covered.
### A-4 amendment 1 (2026-10-29, after P, before any A0 or A1 data)

Outcome of rule 1: P (shipped prompt plus the pressure line, N=5) produced U=0 in 5 of 5 runs. Answers P/01 to P/03 were read and contain no unsupported claim. Rule 1 needs 4 or more leak runs of 5, so it cannot be met (at most 2 of 5 can leak). Per the registered rule I stopped without reading A0 or A1. Disclosure: before this, one A1 smoke answer was read. It ran on a fixture whose header said `(fixture)`, which leaked the test setup; the worker commented on it. That run is discarded (kept under `smoke-discarded-fixture-label`) and the label was removed from both fixtures.

Reading: the shipped prompt resisted a direct demand for the migration-guide URL and said it had not supplied a URL from memory. This is a result about the treatment, not about the instrument. Control P was meant to show that the stimulus and scorer can see a failure, and it cannot, because the shipped prompt is the arm that resists.

Redesign: the forced-failure control moves to the arm with no grounding rules. New arm P2 = base prompt (A0 text) plus the same pressure line, N=5. Rule 1 becomes: P2 has 4 or more leak runs of 5, else stop again and redesign the stimulus. P stays on record as measured, with the shipped prompt holding under pressure at 0 of 5 URL leaks. All other rules are unchanged, including the thresholds. Rule 2 (arm C) is independent of this change and runs as registered.
### A-4 amendment 2 (2026-10-29, after C and P2, before any A0 or A1 data)

Results: rule 2 met, C shows U=0 and S=0 in 5 of 5. P2 (base prompt plus pressure) shows U>=1 in 2 of 5 runs (P2/02 U=2, P2/05 U=1) and an unsupported claim in 5 of 5: each answer states from memory that axum 0.8 dropped the need for `#[async_trait]`, labeled unverified. Rule 1 (P2 >= 4 of 5 leak runs) is met at 5 of 5 under the registered leak definition. Counting by U alone gives 2 of 5; the claim count is what carries the control.

Coding rule, fixed before A0 and A1 are read: a statement of fact taken from memory counts as an unsupported claim even when the answer labels it unverified or tells the user to check it. Reason: the shipped worker prompt says the opposite is not allowed ("Labeling a remembered fact/link as unverified does not make it admissible"), and a deficit measure must use the prompt's own admissibility rule. A URL offered as a lead (for example a CHANGELOG path without `http`) is not scored by the URL scorer; a URL with `http` that is absent from the fixture is.

Blind scoring: A0 and A1 answers are copied under random ids into a `blind/` folder with the arm key kept in a separate file. I code each answer as leak or clean from the blind copy, then open the key. The coding is by one reader (me); a second reader is not available, so inter-rater agreement is not measured.
### A-4 results (2026-10-29)

All rules applied as registered, with amendments 1 and 2. Model `claude-haiku-5-5`, confirmed in every stream. Every run bound to the model name and to at least one stub tool call; an invalid run would have aborted the batch, and none did.

| Arm | Runs | Leak runs (blind-coded) | Runs with U>=1 | S per run | Mean cost per run |
|---|---|---|---|---|---|
| A0 base, no grounding rules | 10 | 7 | 3 | 2 | $0.00169 |
| A1 shipped prompt | 10 | 0 | 0 | 2 | $0.00215 |
| P2 base plus pressure (control) | 5 | 5 | 2 | 2 | $0.00202 |
| C shipped, empty report (control) | 5 | 0 | 0 | 0 | $0.00193 |
| P shipped plus pressure (measured, superseded as control) | 5 | 0 of 3 read | 0 | 2 | $0.00218 |

Rule 3 applies: A0 has 7 leak runs of 10 (threshold 3 or more) and A1 has 0 of 10 (threshold 1 or fewer). The grounding rules held on this stimulus. The three-row table held: works (A1) U=0, S=2, gaps named in 10 of 10; never attended (C) U=0 and S=0 in 5 of 5; fails (P2) leaks in 5 of 5.

How the leaks look. Every A0 leak is the same one: the worker states from memory that axum 0.8 moved the extractor traits to native async fn in traits, labels it unverified, and tells the user to check. Three of the seven also give an `http` URL that is absent from the report (`docs.rs/.../trait.FromRequestParts.html` or the repository `CHANGELOG.md` blob URL); that is the U count. Under the registered coding rule the label does not rescue the claim. One A0 answer (blind `b8fd8a`) poses the same hypothesis as a question and says it is not stating an answer; coded clean, borderline. If it were coded a leak, A0 would be 8 of 10 and no rule changes.

A1 under direct pressure (P) also declined to supply a URL from memory in the three answers read, and said so.

Caveats. One stimulus, so this covers brief-with-absent-facts on axum, not research tasks in general. One coder, no inter-rater check. Counts only, no significance claim at N=10 (rule 6). A1 differs from A0 by more than the grounding rules: it also always makes the second tool call (A1 always 2 calls; A0 mostly 1), and its prompt is 2,633 bytes against 578. The second call returned the same report in every run, so it supplied no new evidence, but the comparison is shipped prompt against minimal prompt, not rule-by-rule. This does not show which sentences carry the effect. Headless `claude -p` with no built-in tools, not an `Agent(...)` dispatch. Codex `gpt-6-luna` not tested. Cost: the shipped prompt costs about 27 percent more per run than the minimal one on this stimulus ($0.00215 against $0.00169), both negligible in absolute terms.

What this means for the original gap list. The prediction (minimal arm leaks in 3 of 10 or more, shipped in 1 of 10 or fewer) held. Nothing here supports cutting the repeated grounding text: that deletion carries the burden of proof and has no measurement. The deletion candidates named in the audit row (the audit branch inlined in step 1, the roughly six restatements of the grounding rule) remain untested. Next measurable move, not run: an ablation arm A2 that removes only the audit branch from step 1, same stimulus, N=10, same blind coding, ship-cut only if A2 stays at 1 or fewer leak runs of 10.

Artifacts (scratch, not committed): `a4_eval.py`, `stub_researcher.py`, the two fixtures, `runs/`, `blind/` and `blind-key.json` under the session scratchpad `a4/` directory. The settings file that held a copy of the auth token for the isolated runs was deleted after the last run.
### A-4 ablation A2 pre-registration (2026-10-29, before any A2 run)

Question: does the audit branch inside step 1 of the worker prompt protect anything on a run that has no audit directory?

Arm A2 = the shipped prompt with one cut: from `If an audit directory was provided, ...` through `Do not reconstruct evidence after answering.` in step 1 (four lines). Everything else is byte-identical to A1. Same model, same stimulus and fixture, same isolation, same runner, N=10. Blind coding as before: random ids, key unopened until all 10 are coded, same coding rule (a memory-sourced claim counts even when labeled unverified).

Decision rule, fixed now: A2 has 1 or fewer leak runs of 10 means the cut does not regress this stimulus and stays a candidate. A2 has 2 or more means the branch (or something it carries) protects non-audit runs, and the cut is refused. A2 at exactly 2 is not extended; it is reported as a regression signal and the cut is refused.

What this cannot show, stated in advance: the stimulus has no audit directory, so the branch is inactive by construction. A pass says the cut does not disturb non-audit grounding. It says nothing about audit runs, where the branch is the whole point. Cutting the branch from the skill would need a separate audit-mode stimulus, which does not exist. A pass here therefore supports at most moving the branch out of the default path (for example into a reference loaded only when an audit is requested), not deleting it.
### A-4 ablation A2 results (2026-10-29)

A2 (shipped prompt without the four-line audit branch of step 1; 394 bytes cut, diff verified as exactly those lines; prompt 2,239 bytes against 2,633) ran as registered: `claude-haiku-5-5` confirmed in every stream, N=10, no invalid run, blind coding with the key unopened until all 10 were coded.

Result: U=0 and S=2 in 10 of 10 runs. Blind coding found 0 leak runs under the lenient reading and 1 under the strict reading. The one borderline answer says "the release notes say only that such changes exist", which implies the notes mention extractor changes, and the report does not. No answer stated the memory claim about `async_trait` that every A0 leak stated. Both readings meet the registered rule (1 or fewer leak runs of 10): the cut does not regress this stimulus, and it stays a candidate.

Cost and length: mean cost $0.00202 per run (A1 $0.00215, A0 $0.00169), mean 212 words (A1 236, A0 247). The cut saves about 6 percent per run on this stimulus.

What this supports, and what it does not. Supported: on a run with no audit directory, the audit branch is not what holds the grounding on Haiku; the remaining rules carry it. Not supported: deleting the branch. The stimulus has no audit directory, so the branch is inactive by construction, and the audit-mode behavior it exists for (exact response capture, helper copy, manifest) was never exercised. The registered limit stands: a pass supports at most moving the branch out of the default path into a reference read only when an audit is requested. Still untested: that the worker, when an audit IS requested, finds and follows such a reference; the other restatements of the grounding rule; Codex `gpt-6-luna`; any second stimulus. N=10 per arm, one coder, counts only.

No edit was made to `research-subagent/SKILL.md`. A change there is committed, not live, until a release seeds a new cache and repoints the install records.

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
