---
id: '2e834bce683c9f1b'
kind: tracker
status: active
title: Context Headroom & Buddy Optimization
owners: []
tags:
- headroom
- context-optimization
- llm-proxy
- buddy
- personas
topic: null
time_scope: null
---

Reduce the context-window cost of this Claude Code setup ("headroom") while keeping the buddy specialist system useful. Two coupled fronts: (1) strip unneeded tool definitions at the llm-proxy, with a per-session re-enable safety net; (2) shrink the conversation/message-side bulk, which measurement shows is the larger share.

This is a cross-repo initiative (llm-proxy + buddy plugin + the 3 CC profiles). Tracker lives in the buddy repo by choice.

## Status snapshot (2026-06-22)

| Lever | Status | Where |
|---|---|---|
| Tool-def stripping (15 tools) | done, live | llm-proxy `.env` `STRIP_TOOLS` |
| Per-session re-enable (`/proxy allow…`) | done, merged | llm-proxy `master` @ f8ace1b |
| Langfuse measurement stack | done, committed | llm-proxy `docker-compose.langfuse.yml` |
| pika tool-call audit | done | codescout U-28 |
| Message-side **profiling** | done, 2026-06-22 | see "Message-side composition" below |
| skill_load reduction (18.7%/~27K tok) | **NEXT — big lever** | Skill-tool bodies persist full-text |
| SessionStart superpowers inject (8.7K tok) | candidate | superpowers plugin SessionStart |
| output_style reminder ×92 (4.5K tok) | candidate | user output-style setting |
| Reload-payload slimming (53 KB) | backlog (subset of skill_load) | `buddy/scripts/reload.py` |

## Done — details

### 1. Tool stripping at the proxy
llm-proxy is a Rust Anthropic-API pass-through, run as systemd **user** service `llm-proxy` on 127.0.0.1:8082 (NOT the separate system litellm service of the same name). All 3 CC profiles route through it via `ANTHROPIC_BASE_URL`. It strips tool definitions from each request before forwarding (`src/passthrough.rs` → `apply_request_transforms`, exact-name match). Live `STRIP_TOOLS` (15):

`Workflow, DesignSync, ShareOnboardingGuide, RemoteTrigger, NotebookEdit, CronCreate, CronDelete, CronList, EnterWorktree, ExitWorktree, Artifact, mcp__claude_ai_Atlassian_Rovo__authenticate, mcp__claude_ai_Atlassian_Rovo__complete_authentication, mcp__claude_ai_Slack__authenticate, mcp__claude_ai_Slack__complete_authentication`

### 2. Per-session runtime toggle (`/proxy`)
Merged to `master` (f8ace1b; feature commits f9990df..b82cff8, 7 commits). Lets a session re-enable a stripped tool without restarting the proxy:
- Command: `/proxy allow|deny|reset|status [Tool]` (installed in all 3 profiles' `commands/`).
- Override file per session: `~/.buddy/proxy-overrides/<sid>.json`; proxy computes `effective_strip = (base ∪ strip_extra) − unstrip` (unstrip wins).
- Session id comes from the `x-claude-code-session-id` header, which equals `.buddy/.current_session_id`.
- Code: `src/overrides.rs` (pure `effective_strip` + fail-safe `load` with path-traversal guard), `src/passthrough.rs` (wiring), helper `scripts/proxy-override.sh`, command `commands/proxy.md`.
- Tests: 28 lib + 4 failopen integration, green. Proven e2e on the wire: override → "Stripped 1", control → "Stripped 2".

### 3. Langfuse observability
Local Langfuse v3 stack (`docker-compose.langfuse.yml`, owned by llm-proxy, committed f8ace1b). UI at http://localhost:3000. Proxy logs each request's token usage and, when enabled, tool definitions. Real seed secrets live in gitignored `.env.langfuse-init`; compose file has dev-only inline creds.

### 4. pika audit
codescout-pika audited tool-call hygiene against `.codescout/usage.db`; persisted observations + U-28 (read_markdown untagged errors) in codescout `docs/trackers/codescout-usage-frictions.md`.

## Measurements / findings

- Tool definitions are **~25%** of the window (~42–50 KB, measured directly via `tools_full` logging — NOT the ~68 KB an earlier subtraction estimate gave; that estimate was wrong and was corrected).
- **Messages dominate** the remaining ~75%. This is the untapped lever.
- The SessionStart:compact **reload payload is 53 KB** (`buddy/scripts/reload.py`): it re-injects the FULL `SKILL.md` of every specialist summoned this session, on every compact AND resume. Breakdown for one session's 4 specialists: testing-snow-leopard ~9 KB, architecture-snow-lion ~9 KB, prompt-hamsa ~11 KB, codescout-pika ~23 KB. Cost compounds with each additional summon.
- Prompt caching: reported input tokens are the non-cached delta; real total = `cache_read` + `cache_creation` + `input`. Tool defs are cached (cheap in $) but STILL occupy the window.
- **How to measure tool-def size:** set `LOG_FULL_TOOLS=1` in llm-proxy `.env`, `systemctl --user restart llm-proxy`, read `tools_full` in Langfuse, then revert. (Currently OFF, as it should be.)

## Message-side composition — measured 2026-06-22 (backlog item 1, DONE)

Profiled directly from Langfuse: `build_langfuse_input` (`llm-proxy/src/passthrough.rs:531`)
already captures the **full `system` + full `messages`** verbatim on every request (tool
*bodies* are the only thing gated, behind `LOG_FULL_TOOLS`). So the message side needs **no
proxy change** to measure — pull a request's `input` via the Langfuse public API and bucket it.
Method + scripts: `scratchpad/lf_fetch.py` (rank by input size) + `decompose.py` (bucket).
Tokens ≈ chars/4.

**Main-agent request, long session (~144K tok body, 281 msgs, 101 tools surviving strip):**

| bucket | ~tok | % | group |
|---|---|---|---|
| tool_result (outputs) | 56,400 | 39.2% | conversation |
| **skill_load** (6 full SKILL.md as user msgs) | **26,900** | **18.7%** | triggered inject |
| assistant_tool_use (incl. big create_file writes) | 23,400 | 16.2% | conversation |
| assistant_text | 14,300 | 9.9% | conversation |
| sessionstart_inject (superpowers `using-superpowers` verbatim) | 8,700 | 6.0% | FIXED |
| claudeMd+ctx (stacked CLAUDE.md + env) | 6,900 | 4.8% | FIXED |
| output_style_reminder (×92 — once/turn) | 4,500 | 3.1% | FIXED |
| sys_prompt (harness) | 2,400 | 1.7% | FIXED |
| assistant_thinking text | 0 (signature-only, wire-only ~140K chars) | 0% | — |
| **FIXED overhead** | **22,800** | **15.8%** | |
| **TRIGGERED (skills)** | **26,900** | **18.7%** | |
| **CONVERSATION (real work)** | **94,400** | **65.5%** | |

**Subagent request (~58K tok body):** FIXED overhead is a larger share (**30.2%**) because
subagent histories are short — claudeMd+ctx 6.9K tok + subagentstart_inject (codescout routing)
6.5K tok dominate the fixed part; tool_result 59.4%.

### Findings that reframe the roadmap

1. **The "tool defs ≈ 25%" figure is session-length-dependent.** Tool bodies are *separate*
   from this 144K-tok body. Early-session (short history) they're ~25%; in a long session
   messages balloon and tools fall to **<10%**. Confirms message-side is the lever for real work.
2. **Conversation (65.5%) is mostly genuine and grows unbounded** — `tool_result` outputs (39%)
   are the single biggest bucket. Only reducible via *tooling discipline* (codescout `@cmd`
   buffers, narrower reads/diffs), not a one-shot cut.
3. **`skill_load` (18.7% / ~27K tok) is the big newly-quantified lever.** Every skill invoked via
   the Skill tool injects its full `SKILL.md` as a user message that **persists for the rest of
   the session**. 6 skills = 107 KB here; largest single = 38.9 KB. This is the *general* form of
   the P2 reload-payload problem (buddy specialists are just one source).
4. **Cleanest FIXED cuts (cut once → save every request, every session):**
   - **`sessionstart_inject` — 8.7K tok**, the single largest fixed block: superpowers' SessionStart
     hook injects the entire `using-superpowers` SKILL.md verbatim, every session.
   - **`output_style_reminder` — 4.5K tok**, pure recurring waste: the "Explanatory output style is
     active" line is re-injected **every turn** (92× in this session). Eliminated by switching to
     the default output style (user setting), or unavoidable harness behavior otherwise.
   - **claudeMd+ctx — 6.9K tok**: mostly legitimate. The near-duplicate global CLAUDE.md is
     **profile-specific** (this `.claude-sdd` setup loads `~/.claude/CLAUDE.md` *and*
     `~/.claude-sdd/CLAUDE.md`); not a universal lever — `req_top` (main profile) had one copy.
5. **thinking signatures**: ~140K chars of opaque thinking-block signatures ride on the wire but
   are **not** context tokens (CC strips the reasoning text, keeps the signature). Wire cost, not
   headroom — ignore for window budgeting.
## Backlog — prioritized for a clean session

Re-measure via Langfuse (`scratchpad/decompose.py`) before AND after any cut.

1. **~~Profile the message-side~~ — DONE 2026-06-22.** See "Message-side composition" above.
   The data reprioritized everything below.

2. **Attack `skill_load` (P1, ~27K tok / 18.7%) — the big lever.** Every Skill-tool invocation
   injects its full `SKILL.md` as a user message that persists all session. Sub-levers:
   a. **Reload payload** (`buddy/scripts/reload.py`, ~53 KB): replace full-SKILL.md re-injection
      on compact/resume with a compact digest (Voice + Operating Principles), pull body on demand.
      Guarded by `tests/test_reload.py`, `tests/test_hooks_session_start.sh`. (was P2)
   b. **Audit which skills auto-load vs are invoked** — trim fat SKILL.md bodies we own (buddy
      specialists, codescout-companion). Investigate whether CC retains skill bodies after use or
      can evict them (harness question — verify, don't assume).

3. **Trim FIXED per-request overhead (P2) — cut once, save everywhere.**
   a. **SessionStart superpowers inject (8.7K tok):** superpowers injects `using-superpowers`
      verbatim every session. Decide: trim, gate, or accept (it's a 3rd-party plugin — confirm
      ownership/options before editing).
   b. **output_style_reminder ×92 (4.5K tok):** switch to default output style if "Explanatory"
      isn't needed, else accept (harness re-injects per turn).

4. **Conversation hygiene (P3, ongoing, not a one-shot).** `tool_result` (39%) + `assistant_tool_use`
   (16%) are the bulk and grow unbounded — manage via codescout `@cmd` buffers, narrower reads,
   smaller diffs. A discipline lever, not a code change.

5. **Profile-specific: CLAUDE.md dedup.** `.claude-sdd` loads two near-identical global CLAUDE.md
   files (~6.9K tok block). Low priority, profile-local only.
## Key locations

- **llm-proxy:** `/home/marius/agents/llm-proxy` — `.env` (`STRIP_TOOLS`), `src/passthrough.rs`, `src/overrides.rs`, `scripts/proxy-override.sh`, `commands/proxy.md`. `master` @ f8ace1b, working tree clean.
- **buddy plugin:** `/home/marius/work/claude/claude-plugins/buddy` — `scripts/reload.py` (reload payload), `skills/<specialist>/SKILL.md` (persona bodies), `scripts/summon_bootstrap.py` (summon hook).
- **codescout frictions:** `/home/marius/work/claude/codescout/docs/trackers/codescout-usage-frictions.md`.
- **3 CC profiles:** `~/.claude`, `~/.claude-sdd`, `~/.claude-kat` — config changes apply to ALL three.
- **Langfuse UI:** http://localhost:3000.

## Session passover (clean-slate start)

- Proxy service `llm-proxy` is **active** with the 15-tool strip live. Verify: `systemctl --user status llm-proxy`.
- All llm-proxy work committed; working tree clean; branch `proxy-runtime-toggle` deleted (fully merged into `master`).
- `LOG_FULL_TOOLS` / `LOG_TOOL_DIGEST` are OFF (measurement toggles reverted).
- **To resume:** read this tracker, then start with backlog item 1 (profile the message-side). The two coupled facts to keep in mind: tool defs ≈ 25%, messages ≈ 75%.
