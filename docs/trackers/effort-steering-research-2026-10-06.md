---
id: '8ad5f00472dc1e42'
kind: tracker
status: draft
title: Effort steering — research landscape (2026-10-06)
tags:
- effort-steering
- research
topic: effort steering research landscape
time_scope: dated:2026-10-06
branch: main
origin_session_id: a615adc6-bb51-4a2d-9b95-d6bc7ab52569
---

# Effort steering — research landscape (2026-10-06)

## Provenance and confidence

Compiled from six subagent reports: one surface scout and five deep dives (steering text, routers, hook mechanics, signals, evaluation). The agents opened pages with a fetch tool that summarizes them, so every number below is "as reported by the agent". The author did NOT re-check any source. Tags: READ = the agent opened the page and read the relevant part; SNIPPET = search-result text only. Where a claim is inference, the entry says so. Model names (Sonnet 5.5, Opus 5.5, Fable) appear as the agents saw them.

Companion entries: `ES-12` (S4 method), `ES-13` (turn_id and injected messages), `ES-14` (decisions this research forces).

## Bottom line

- Every vendor gives a per-request or per-session effort dial. Anthropic's is `output_config.effort` plus adaptive thinking.
- No source measures steering sentences against billed `thinking_tokens` under adaptive thinking on real coding turns. S4 would be new.
- Per-step effort routers (Ares, TAB) save about 20 to 45 percent of tokens at near-fixed-high accuracy, but not on coding in a repository. No source tests rules or keyword heuristics against learned routers for effort.
- Prompt text alone is a weak predictor of needed effort (about AUC 0.6 for coding-agent success). Stronger signals sit in agent-loop state and task structure.
- Seven community hooks exist. None validates the effect of its steering text. Most call a small model and add 4 to 12 s.
- A `UserPromptSubmit` hook can return only `additionalContext` (plus block and title). It cannot set effort, and it cannot tell typed prompts from injected messages.

## 1. Controls: Anthropic and Claude Code (READ unless noted)

- `output_config.effort`: low, medium, high, xhigh, max. It is "a behavioral signal, not a strict token budget" and also changes text and tool calls. Sonnet 5.5: API default high; Claude Code default medium (per the model-config page as the agent read it). Anthropic says to start at medium for well-specified agentic coding and to run a fresh sweep, because levels are recalibrated per model.
- `thinking: {"type":"between_tools"}` is the lowest setting. It is valid at low, medium and high, and returns 400 at xhigh and max. With it, effort cannot change mid-conversation.
- In a tool loop, the first request after new user input carries most of the reasoning (Anthropic docs). Our own transcripts do not show this for long Claude Code turns (ES-15: the first message holds 9.4 percent of a turn's thinking tokens). Follow-up requests that only process tool results can skip thinking, even at xhigh and max. Per-request thinking tends to fall as the conversation grows.
- Cache: a top-level effort change restarts the prompt cache. Text appended to the newest user message leaves earlier cache breakpoints intact, but it accumulates in the transcript.
- Per-message effort (beta): header `mid-conversation-output-config-2026-07-01`, a message `{"role":"system","content":[],"output_config":{"effort":"low"}}`. It keeps the cache and takes effect from the next user turn. A third-party post says Claude Code 2.1.260 pins effort per user message (`perTurnEffortPins`). Nothing the agents read exposes this to a hook. (See `ES-15` for what our own traces show.) Confirmed locally: the proxy traces show effort pins, `{"role":"system","content":[],"output_config":{"effort":"medium"}}`, inside the request messages of recent Claude Code sessions.
- Per-message steering text: "Please think hard before responding." encourages thinking; "Answer directly without deliberating." suppresses it. Anthropic: wording sensitivity is high, measure before you ship, and lowering effort is the better first lever. No numbers are published.
- Sonnet 5.5 prompting guide: asking in the system prompt to think less "doesn't reliably reduce its thinking". From medium up the model "thinks briefly before almost every reply". "Think the problem through before you answer." at high brings accuracy close to xhigh. With `between_tools`, remove instructions that tell the model not to think: they make the model more likely to write internal XML tags into visible output.
- `ultrathink`: the Claude Code model-config page says it adds an in-context instruction and the effort sent to the API is unchanged. One blog says it sets high effort for one turn (changelog 2.1.68). Issue #99498 says docs and changelog conflict. The July 2025 budgets (think 4,000, think hard 10,000, ultrathink 31,999 tokens) are obsolete for adaptive models.
- Other vendors (SNIPPET): OpenAI `reasoning_effort` and a GPT-5 router in ChatGPT; Gemini `thinkingBudget` (2.5) and `thinkingLevel` (3+); Qwen3 `/think` and `/no_think`; DeepSeek `thinking` plus `reasoning_effort`.

## 2. The hook contract (READ: code.claude.com hooks docs, #94675, #95347, #95240, #92444)

- Input for UserPromptSubmit: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `prompt`; also `prompt_id`, `session_title` (when set), `scratchpad_dir` from v2.1.257. `effort.level` is documented only for tool-use events (PreToolUse, PostToolUse, Stop, SubagentStop). Issue #60200 claims otherwise, with no source. `$CLAUDE_EFFORT` for this event is unverified.
- Output: top-level `decision` (only "block"), `reason`, `continue`, `stopReason`, `systemMessage`; under `hookSpecificOutput`: `hookEventName`, `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`. Plain stdout on exit 0 is also added as context. Exit 2 blocks. No effort or model field (requests #34874 and #95347 are open).
- Limits: `additionalContext` is capped at 10,000 characters. Default timeout 30 s; on timeout the output is discarded and the prompt proceeds. Injected text is stored in the transcript and replayed on resume. There is no matcher for this event.
- Origin: none in the payload. Issue #94675 (open) says the transcript has `promptSource` (typed, queued, system) and `isMeta`, but the hook sees task notifications, cross-session agent messages, cron and heartbeat messages and Stop-hook feedback as plain `prompt`.
- Settings write: contested. Official docs say `effortLevel` is read once at session start. Two projects (v2.1.263, v2.1.282) saw no effect on a running session. One project (v2.1.177, n=1) saw a rise between turns. #95347: only the global file was followed; concurrent sessions overwrite each other. #95240: `CLAUDE_CODE_EFFORT_LEVEL` in the settings `env` block latches and discards later writes. `max` in settings is silently ignored.
- Skill frontmatter `effort` overrides the session level while that skill or subagent is active: the only documented per-turn effort route inside Claude Code. It costs a round trip and invocation is not guaranteed.

## 3. Prior art: hooks and harnesses

| Project | Approach | Classifier | Latency | Fail-open | Validated how | Tag |
|---|---|---|---|---|---|---|
| blackreo123/claude-code-auto-effort | writes `effortLevel`, injects a directive | Haiku via `claude -p`, prompt only, 4,000-char cap | 4 to 7 s, 12 s timeout | yes, exit 0 | `calibrate.js`, n=1, v2.1.177; directive effect NOT measured | READ |
| Qcko/claude-code-effort-router | prints a depth line | keyword, length, file-reference score | about 150 to 300 ms | not documented | smoke test and an after-the-fact analysis | READ (README) |
| cfitzgerald-pd/effort-router | hooks re-anchor; model picks a tier skill whose frontmatter `effort` holds for the turn | the model itself | extra round trip, 1 to 3 s | misroutes flagged afterwards | token log, no accuracy | READ |
| pc-style/jev-effort | directive via `additionalContext`; Stop hook nudges `/effort` | remote model | 6 s timeout | silent exit | decision log; a settings write did not change a running session (v2.1.282) | READ |
| JeronimoRepetto/effort-autopilot | blocks the prompt, types `/effort` in a pseudoterminal, replays the prompt | deterministic rules | milliseconds | yes | 213 tests; archived | READ |
| hodkovickybuh/claude-auto-model | own controller via `set_model` and `apply_flag_settings` | Haiku | 9.8 to 11.3 s median | Opus/high fallback | 32-case dev corpus | READ |
| totally-tim/effort-router | per-turn Claude Code router | judge-labelled | not read | not read | labels from a judge that sees the work but not the router's guess or the recorded effort; at most one task per session; frozen manifest, hash and seed; `/effort-router wrong <level>` tag; README: label agreement "does not establish task success or cost savings"; results files not opened | READ (README) |
| yigitkonur/auto-approve-claude-plan | injects `ultrathink` text in plan mode | none | n/a | silent | not stated | SNIPPET and summary |

Open feature requests with no implementation: Codex #8649 and #47785 (Auto effort), claude-code #34874. The Gemini CLI discussion #3064 does not describe a Flash-Lite classifier (the scout said it did); it lists routing as future work in July 2025.

Failure modes others hit: a prompt hook stalling on `<task-notification>` messages (codegraph #1832, 3.5 s median and 7.4 s max, SNIPPET); behavioural directives injected off a subagent's report (#94675); `additionalContext` not reaching the model in the VS Code extension (#49063, SNIPPET); one-sentence nudges accumulating in the transcript.

## 4. Does steering text move thinking?

| Source | Model | Measured | Effect | Tag |
|---|---|---|---|---|
| wmedia.es tip #208 (2026-09-24, Claude Code v2.1.281) | Opus 5.5, tools off | median `thinkingTokens`, 5 problems x 3 runs x 3 configs (45 runs) | medium 901; +ultrathink 1,148 (+27%); `--effort high` 1,102 (+22%). On 3 of 5 problems no config exceeded 300 reasoning tokens | READ |
| raindrop.ai think-harder | Opus 5, Sonnet 4.6, 3 OpenAI | 3 easy math problems, 5 variants | Opus 5 low + think-hard: total 424 to 704 (+66%), reasoning 42 to 54. Sonnet 4.6 high brief: 552 (user) vs 805 (system) | READ; no repeats, no variance |
| arXiv 2608.01347 (Prompt-Induced Waste in Coding Agents) | Sonnet 5 in Claude Code 2.1.220, 6 open models | paired reasoning ratio, 24 tasks, 4,644 runs | `deep_thinking` 1.25 to 1.30x output tokens; `max_certainty` 4.13x tokens and 2.7x cost per success; verbose, autonomy, bounded-efficiency about 1x. Stop-early prompt on an ambiguous spec: 3/5 hidden-test failures vs 0/5. Effort arm cut cost 74.7% on a DeepSeek harness but only about 19% under Claude Code | READ |
| arXiv 2511.01170 (DART) | Qwen3-8B | "reduce 90% of CoT tokens" | -42.7% (50% request: -37.2%; non-monotonic) | READ |
| arXiv 2503.01141 | GPT-4o, Claude 3.5 Sonnet, others; 31 prompts | CoT length vs accuracy | Claude 3.5 Sonnet MMLU-Pro Math: default 81% at 324 tokens, BeConcise 78% at 227, OnlyNumbers 77% at 130 | READ |
| arXiv 2507.14417 | Sonnet 3.7/4, Opus 4, o-series | "don't think / think / think harder / ultrathink" | more tokens as more reasoning is requested; not linear | READ (token counts not seen) |
| Wharton report 2 | o3-mini, o4-mini, Gemini Flash 2.5 | "step by step" vs direct, 25 runs per cell | accuracy +2.9%, +3.1%, -3.3%; time +20 to 80% | READ |

Transfer to Claude adaptive thinking: the direction ("think hard" up, "brief" down) and the imprecision carry over. Open-weight studies use a fixed thinking mode or a stated budget; adaptive Claude decides per request whether to think. "Think less" is weaker than "think more". Reasoning may spill into visible text, so measure `output_tokens` too. Inference from the Anthropic docs (untested, and CONTRADICTED by our own transcripts, see ES-15): a hook injection acts mainly on the first request of a turn. In 2,583 real Claude Code turns the first assistant message holds only 9.4 percent of the turn's thinking tokens; most of it comes later in the tool loop, and the steer stays in the context for those requests. Measure the whole turn.

Experiment-design lessons: paired blocks against a block-median baseline, task-clustered bootstrap CIs and sign-flip permutation tests, a preregistered "wasteful" gate (2608.01347); 25 repeats per cell (Wharton). Avoid: no repeats and no variance (Raindrop). Named confounds: cache hits are probabilistic; `max_tokens` is per request; `thinking_tokens` appears only on the final `message_delta` event when streaming.

## 5. Routers and labels

| Method | Unit | Inputs | Label | Savings | Domain | Tag |
|---|---|---|---|---|---|---|
| Ares 2603.07915 | agent step | task, history, observation; Qwen3-1.7B writes a short rationale and a level | lowest level reproducing the reference action in all 3 samples; SFT then GRPO | tokens vs fixed-high (gpt-oss-20b): Retail 1,007k to 652k, WebArena 2,763k to 1,512k, BrowseComp-Plus 1,841k to 1,071k, Airline 873k to 678k; accuracy about equal | TAU-Bench, WebArena, BrowseComp-Plus; no coding | READ |
| TAB 2604.05164 | turn | history and sub-question | none; GRPO reward | up to 20% on BFCL, Tau-Bench, Terminal-Bench; up to 35% on math | math, agentic | READ (HTML) |
| Learning When to Think 2608.20256 | prompt | problem text | none | MATH-500 4,796 to 2,811 tokens (-41%) | math, 1.5B | READ |
| DART 2606.23181 | query | two no-think drafts | none | thinking tokens -32% to -73% | math, code | READ |
| SelfBudgeter 2505.11274 | query | question | own correct lengths | 61% (1.5B), 48% (7B) | math | READ |
| TwinRouterBench 2605.18859 | call within an agent run | latest request embedding plus metadata | execution-verified minimal tier | trained router -53.1% API cost on 100 SWE-bench Verified, 75 vs 74 resolved | SWE-bench and others | READ |
| SWE-Router 2607.00053 | task after K weak turns | issue and K triples | did the weak model's patch pass | Route-AUC 0.780 (K=2) vs 0.627 (K=0) | SWE-bench | READ |
| RouteLLM 2406.18665 | query | query text | Arena preferences plus augmentation | MT-Bench 3.66x fewer strong calls at about 95% of GPT-4 quality | model choice | READ |

Rules versus learned: no source compares a rules, keyword or length heuristic with a learned router for within-model effort. TwinRouterBench's third-party rule-based routers (model-tier, not effort) were weaker: one cost $172.56 on the dynamic track against $54.73 for unrouted Opus. Rules with some support: high effort on the first step and after tool errors, low for later simple steps (pydantic-ai #9009 proposal; Ares observes low effort early and more high later in WebArena). No measured results for the proposal.

Ares "up to 52.7% fewer tokens" is not traceable to any table; the section figures are 35.2% (Retail), 41.8% (BrowseComp-Plus), 45.3% (WebArena). Router overhead is not reported by Ares or TAB.

Label construction worth copying: Ares (K=3 samples per step and level, equivalence by exact tool match or a judge) and TwinRouterBench (greedy downgrade from the cheapest tier, accept if the whole trajectory still passes; a pool of 3 models recovered 28 of 33 downgradeable labels against 15 of 33 with one model). Both are estimates, not true optima.

## 6. Signals that predict needed effort

| Signal | Predicts | Strength | Cost | Tag |
|---|---|---|---|---|
| prompt features, SWE agent (2608.18280) | agent success | AUC 0.599 / 0.593 (27 features); patch-only 0.846 (uses the gold patch) | cheap | READ |
| problem statement via LLM-judge features (2604.00594) | task difficulty | problem-only AUC 0.786 (SWE-bench Verified), 0.789 (Terminal-Bench 2.0) | needs an LLM call | READ |
| pre-rollout features (2608.05797) | IRT difficulty | Spearman: context length 0.086, embeddings 0.107, entropy 0.193, all 0.399 (0.225 on unseen benchmarks); a constant predictor already gets response AUC 0.715 | varies | READ |
| hidden-state probe (2506.08390) | reasoning tokens | Spearman about 0.84, math only, open weights | needs activations | READ |
| gold-patch file count (2608.01347, App. N) | Sonnet 5 compute | rho 0.45 to 0.49; Opus 5 "little" | not known at prompt time | READ |
| query-only routers (RouteLLM) | strong vs weak model | latency 15 to 45 ms | cheap | SNIPPET |

Short continuation prompts ("go", "5", "yes"): no study measures them. Indirect evidence says history matters (SWRouter 2609.11414: context-aware routing 40.89% vs 24.63% for the best single model; vLLM semantic-router #1751 describes "looks good, commit it" routed as an isolated turn). Practical reading: treat a short prompt as "unknown, inherit the previous turn's state", not as shallow. Pitfalls: length is a weak proxy; AUC is inflated without a constant baseline; observed thinking is a noisy label because models do not ration themselves ("Thinking Hard, Not Smart", abs READ); a policy tuned on one model may not hold on another.

## 7. Evaluation and golden sets

- Metrics: cost per successful task (2608.01347), AUC_OAA (OptimalThinkingBench 2508.13141, easy questions only), OckScore (2511.05722), pass@1 with CIs over K=3 runs (SWE-Serve 2609.26777). We have no success signal per turn, only tool errors.
- SWE-Serve (HTML): Opus 5 high to max: pass@1 74% to 75% at $9.89 to $17.40 per task (+76%). Four configurations tied at 64% differed 7.6x in cost ($0.95 to $7.24). The text and Table 3 disagree on one configuration (55% vs 64%).
- 2607.12161: cache creation plus reads are about 80% of the bill; cost intraclass correlation across repeats 0.37 to 0.55, so 712 runs per arm give roughly 38 to 45 effective tasks. 2608.25399: repeat spend has a median geometric SD of x1.34 and grows with cost; most turns do not separate effort levels.
- Small human-labelled sets: use them to calibrate a cheap proxy with prediction-powered inference or Rogan-Gladen (2511.21140), with stratified allocation (StratPPI 2406.04291). No source gives a protocol for per-turn "effort appropriateness". Inference, not sourced: 50 labels give about +-14 points; treat them as a calibration set, keep the design weights, keep `unclear`, define levels by what was needed and not what was spent, re-label 10 to 15 after a few days, and never use thinking-token spend as the label.
- Counterfactual replay at several levels is feasible only for turns with a checkable result and needs at least 3 repeats per level and an isolated worktree. Repeats of one setting differ by up to 30x in tokens (2604.22750, SNIPPET).

## 8. Contradictions and corrections

| Question | Sources | Reading |
|---|---|---|
| `effort.level` in UserPromptSubmit | scout and #60200: yes. Hooks docs and #95347: tool-use events only. Our fixture: no field | treat as absent |
| what `ultrathink` does | model-config docs and wmedia: in-context note, effort unchanged. crossvalid.com: high effort for one turn. #99498: docs vs changelog | docs reading better supported; one small test shows about one effort step in token count |
| does a settings write change a running session | docs: read once. Two projects: no. One project: yes (n=1). #95347 and #95240: depends on how the key was set | unresolved, version-dependent |
| does effort change the cache | Claude Code caching page: no. #92444 measurements: partial miss on Sonnet 5, full rewrite on Opus 5, none on Fable 5.1 | measurements win |
| Ares 52.7% | abstract vs section figures | do not quote 52.7% |
| scout lead 2609.01603 | scout: difficulty prediction. Agent: benchmark cost (PTA-IRT) | not usable for that |
| scout lead 2601.05777 | scout: overthinking. Agent: EET early termination for SWE agents | the overthinking paper is 2606.02835 |
| Gemini CLI classifier | scout: exists. Agent: future work in discussion #3064 | unsupported |
| "think less" | Sonnet 5.5 guide: unreliable. Steering page: "Answer directly" suppresses | no numbers either side |

## 9. Sources (opened by the agents)

Anthropic: platform.claude.com/docs/en/build-with-claude/effort, .../thinking-steering-and-cost, .../prompt-engineering/prompting-claude-sonnet-5-5; code.claude.com/docs/en/hooks, /model-config, /settings. Issues: anthropics/claude-code #60200, #34874, #94675, #95347, #95240, #92444, #99498; openai/codex #8649, #47785; pydantic/pydantic-ai #9009; vllm-project/semantic-router #1751. Repos: blackreo123/claude-code-auto-effort, Qcko/claude-code-effort-router, cfitzgerald-pd/effort-router, pc-style/jev-effort, JeronimoRepetto/effort-autopilot, hodkovickybuh/claude-auto-model, totally-tim/effort-router. Papers (arxiv.org): 2603.07915, 2604.05164, 2608.20256, 2606.23181, 2505.11274, 2605.18859, 2607.00053, 2406.18665, 2603.04445, 2608.18280, 2604.00594, 2608.05797, 2506.08390, 2602.01237, 2508.00912, 2605.15454, 2608.01347, 2609.11414, 2508.13141, 2609.26777, 2607.12161, 2511.05722, 2606.02835, 2511.21140, 2406.04291, 2608.25399, 2606.08275, 2511.01170, 2503.01141, 2507.14417. Blogs: wmedia.es (ultrathink tips), raindrop.ai (think-harder), crossvalid.com (ultrathink), gail.wharton.upenn.edu (CoT report), xda-developers.com (medium vs high, one run per setting, anecdote).
