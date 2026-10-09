---
id: e3f8b63111387c09
kind: tracker
status: draft
title: Fork and subagent prompt caching — research findings
owners:
- marius
tags:
- research
- prompt-cache
- forks
- subagents
- claude-code
topic: fork-prompt-cache
time_scope: dated:2026-10-09
---

# Fork and subagent prompt caching — research findings

Research run 2026-10-09: three parallel subagents (API mechanics, Claude Code fork
semantics, empirical measurement from local transcripts). Local `claude` was `2.1.291`
at the start; the newest changelog entry read was `2.1.295`.
**Provenance:** `[doc]` is an official page a subagent read. `[changelog vX]` and
`[issue #N]` are GitHub sources. `[measured]` is computed from this machine's transcripts.
`[community]` is unofficial. `[inferred]` is not verified. The main session re-checked one
measured number against the raw transcript (see *Measurements*).

## Short answer

- A fork's first request reads the parent's whole prefix and writes only a small tail `[doc][measured]`.
- Parallel forks each read the parent's prefix. They do not share their own tails with each other `[measured]`.
- The parent's prefix lasts 1 hour here. A fork's own new writes last 5 minutes `[doc][measured]`.

## API mechanics `[doc: platform.claude.com prompt-caching]`

- **Key.** The cache covers `tools`, `system`, `messages` in that order, up to the block with
  `cache_control`. It needs 100% identical segments. The key is a hash of the prompt up to
  the breakpoint. The model is part of the key.
- **Invalidation.** A change at one level invalidates that level and all later levels.
  Tool definition edits invalidate everything. Fast mode invalidates system and messages.
  `tool_choice`, images, thinking config and `output_config.effort` invalidate messages.
- **Breakpoints.** Up to 4 per request. Automatic caching moves one breakpoint forward and
  uses one slot. A read looks back 20 blocks. A run of parallel `tool_use` blocks counts as one position.
- **TTL.** Default 5 minutes; optional 1 hour with `"ttl": "1h"`. Each hit refreshes the
  TTL at no cost. The TTL counts from the start of the request, not from the end of its response.
  A 1-hour entry must come before any 5-minute entry in a request.
- **Price.** 5-minute write 1.25x base, 1-hour write 2x, read 0.1x. Sonnet 5.5 reads were cut to 0.05x on 2026-10-07.
- **Concurrency.** Quote: "a cache entry only becomes available after the first response
  begins. If you need cache hits for parallel requests, wait for the first response before
  sending subsequent requests." `max_tokens: 0` pre-warms an entry without generating output.
- **Isolation.** Per workspace on the Claude API; per organization on Bedrock and Vertex.
  Sessions in one workspace with an identical prefix can share an entry `[inferred]`.
  The start date (2026-02-05) comes from a third-party source only.
- **Minimum length.** 512 tokens for the 5.x models, 1,024 or 2,048 or 4,096 for older ones.
  A shorter prompt is processed without caching and without an error.
- **Hits are not guaranteed.** The docs state a minimum lifetime only. Cache diagnostics (GA 2026-09-23, Claude API only) report `cache_miss_reason`.

## Claude Code fork semantics

- **Feature.** "Fork mode": the Agent tool with `subagent_type: "fork"`. It is on by default in
  interactive sessions since v2.1.232. `CLAUDE_CODE_FORK_SUBAGENT=1` enables it in `claude -p`.
  `Agent(fork)` is a deny rule. A fork cannot spawn forks `[doc sub-agents][changelog v2.1.232]`.
- **Cache sharing.** The docs table says "Prompt cache: Shared with main session" for a fork
  and "Separate cache" for a non-fork `[doc]`. A fork has the same system prompt, tools, model
  and history. Its model is always the parent's `[doc]`.
- **Non-fork subagent.** It starts with its own system prompt and tools. Its first request does not read the parent's cache `[doc]`.
- **TTL buckets.** Claude Code sets the TTL per request `[doc prompt-caching]`:

| Bucket | Subscription, within plan usage | Usage credits, API key, cloud provider |
|---|---|---|
| Main conversation | 1 hour | 5 minutes |
| Everything else (subagents, workflows, forks, compaction) | 5 minutes | 5 minutes |

- **TTL controls** (first match wins; need v2.1.242 or later): `FORCE_PROMPT_CACHING_5M`;
  `CLAUDE_CODE_PROMPT_CACHE_TTL` or `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`; settings
  `promptCacheTtl` or `subagentPromptCacheTtl`; agent frontmatter `experimental.cacheTtl`
  (not usable for a fork, which has no file); `ENABLE_PROMPT_CACHING_1H`.
- **What breaks sharing.** A model switch (per-model cache). A system prompt or tool
  definition change. Effort change on models other than Opus 5.5, Sonnet 5.5, Haiku 5.5 and
  Fable 5.1. First fast-mode request. MCP connect or disconnect when tools load upfront (no tool search).
- **What keeps the cache.** Permission mode changes, output style (since v2.1.251), skills,
  commands, hooks, CLAUDE.md edits (read once at start), file edits, rewind.
- **Parallel forks.** No official stagger exists for forks. The only stagger is for workflow
  fan-outs: `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`, default 5000 `[changelog v2.1.229]`.
- **Fork internals** `[community: niuma996/claude-code-sourcemap-wiki]`: the child gets the parent
  messages, then one per-child text block. The tools array and system prompt pass through unchanged.
  The `Agent` tool stays in the fork's pool, and the tool errors if called.

## Measurements `[measured]`

Source: all `~/.claude*/projects/**` transcripts: 4,094 files, 308,980 deduped requests. Layout:
`<session>/subagents/agent-<id>.jsonl` plus `.meta.json` (`agentType`, `isFork`). Fork files
start with a `fork-context-ref` line and a copy of the parent's launching message "L".
I deduped by `message.id` (75% of ids repeat across lines; usage fields are identical per id).
Sample: 47 unique forks in 12 parent sessions (68 files; 21 are profile mirrors), versions 2.1.246 to 2.1.295.

- **First request.** In all 47 forks `cache_read` equals L's prompt minus 2 tokens. The write is
  3.5K to 20K tokens, always 5-minute. Read share of the first request: min 0.873, median 0.981.
  The fork starts 3 to 27 seconds after L ends.
- **Steady state.** 1,935 later fork requests: median read share 0.9968, fifth percentile 0.9835.
- **Buckets.** Fork writes: 17,480,254 tokens in 5-minute, 0 in 1-hour. All subagent chains
  write 5-minute only (about 158K requests over three profiles). Main chains write 1-hour only
  (one 5-minute exception per profile).
- **Main chain hit rate after a 1-hour write**, by idle gap: 99.8% below 3,000 s; 90.9% at
  3,500 to 3,600 s; 22.2% at 3,700 to 3,900 s; 1.3% at 3,900 to 4,500 s.
- **5-minute chain hit rate**: 100% below 240 s; 78.8% at 300 to 330 s; 26.5% at 330 to 360 s; 4.9% at 420 to 600 s.
  The measured gaps run late by up to one generation time.
- **Fork chain idle gap**: under 5 min 2,175 of 2,175 hit; 5 to 6 min 10 of 10; 6 to 10 min 0 of 11; 10 to 30 min 4 of 25.
  A miss still reads about 55.8K tokens (system and tools) and rewrites the rest in 5-minute
  (examples: wrote 587,869 and 717,452 tokens).
- **Parallel forks**, four groups (2 or 3 forks each): every fork read exactly L's prefix; none
  wrote the prefix again; none read a sibling's write; each wrote its own 4.8K to 8.8K tail.
  Tail bytes were not compared. One group had a cold parent (262K written at 1 hour); the forks read it 7 to 18 seconds later.
- **Non-fork subagent first requests** (general-purpose, n=1,924): median prompt 80,964;
  `cache_read` share median 0.464; `cache_read` is 0 in 48.5%. First spawn in a session: 0 in 96.2%.
  Siblings within 10 s of each other: 0 in 60.2% (they race and each re-writes the prefix).
  10 to 60 s apart: 82.0% read at least half. Over 60 min apart: 0 in 88.2%.
- **Spot check by the main session.** Session `60b74a30`, agent `ab845e58…`: L read 307,413 and
  wrote 65 (1h); the fork's first request read 307,478 and wrote 15,982 (5m); later requests wrote
  2,821, then 2,155, then 1,271 (5m). This matches the subagent's table.

## Known issues `[issue]` (open on 2026-10-09 unless noted)

- #88444: waking a finished fork (SendMessage) misses the cache after more than 5 minutes idle, or after a tool call. Partly mitigated since v2.1.280.
- #100699: a fork started with `$.agent.spawn` (plugin or mod) never reuses the parent cache. An Agent-tool fork in the same session did.
- #100083: `$.model.fork` misses when Message Threads and a mid-conversation system message are both active (2.1.291).
- #90009: forking right after `/compact` plus a model switch writes the full prefix twice.
- #88755: the advisor tool is missing from internal fork requests, so `/compact` re-bills the conversation (`CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` fixed it for the reporter).
- #88841: one user claims a fork costs 5 to 10 times a fresh subagent. The docs and the measurements above contradict this for tasks that need the same context.

## Open questions

- **FQ-1 — TTL controls on a fork.** The docs place forks in the bucket that `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` and `subagentPromptCacheTtl` control. No source shows a fork honoring them. Probe: set the variable in one profile, launch a fork, read `cache_creation.ephemeral_1h_input_tokens`. A setting change touches the profiles (OP-4), so decide first.
- **FQ-2 — fork with a `model` override.** The docs say it is ignored. No transcript has one. Not tested.
- **FQ-3 — sibling tails.** Are the tails byte-identical across siblings? Compare the launch-result spans, or add a breakpoint there.
- **FQ-4 — refresh of the parent's entry.** The docs say a read refreshes the TTL. No measurement shows a fork read extending the parent's 1-hour entry.
- **FQ-5 — SubagentStart hook context on a fork.** `codescout-companion/hooks/subagent-guidance.sh` injects guidance. Unverified whether a fork receives it or inherits it as part of the parent prefix.
- **FQ-6 — transcript completeness.** Sidechain files cannot be proven request-complete. 20 hits after a gap over 6 minutes are unexplained.
- **FQ-7 — workspace isolation date.** 2026-02-05 comes from a third-party site; the official page has no date.

## Next actions

1. Decide whether to run the FQ-1 probe (changes a setting in the profiles).
2. If forks stay on the 5-minute TTL, keep a long-lived fork active within 5 minutes or accept a full rewrite after an idle gap.
3. Check FQ-5 before relying on the subagent-guidance hook for forks.

## Anti-goals

- Do not read the FQ-1 to FQ-7 entries as findings: they are untested.
- Do not set a TTL variable in one profile only; the three profiles must stay in parity.
- Do not copy the 5-to-10-times cost claim (#88841) into other docs.

Scripts and `reqs.jsonl` are in the session scratchpad `…/scratchpad/fork-measure/`; they vanish with the session.
