---
id: 79e07e7a99e44b52
kind: tracker
status: archived
title: PR19 OpenCode session-bridge audit
tags:
- pr19
- opencode
- review
topic: pr19-opencode
archived_on: 2026-11-25
entry_high_water_F: 9
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Status | Finding |'
---

## Scope
Systematic review of PR #19. Original head: `28c93b458dc421f7ea892b683aae9b0de61610a2`. Source specification: `docs/superpowers/specs/2026-11-17-session-bridge-opencode-design.md`. Preserve concurrent main-checkout work.

## Index
| ID | Date | Severity | Status | Finding |
| --- | --- | --- | --- | --- |
| F-1 | 2026-11-18 | med | fixed-verified | Shell-metacharacter fixture exceeds the notice title contract |
| F-2 | 2026-11-18 | high | fixed-verified | PR predates repository-scoped session listings |
| F-3 | 2026-11-18 | high | fixed-verified | Caller lookup does not validate the returned session identity |
| F-4 | 2026-11-18 | high | fixed-verified | Send deadline does not bound API awaits |
| F-5 | 2026-11-18 | high | fixed-verified | Cancellation during fork creation drops cleanup ownership |
| F-6 | 2026-11-18 | high | fixed-verified | Notice routing trusts payload cwd instead of verified session directory |
| F-7 | 2026-11-18 | med | fixed-verified | MCP all-repository argument forwarding lacks a regression guard |
| F-8 | 2026-11-18 | med | fixed-verified | Default OpenCode listing includes archived sessions |
| F-9 | 2026-11-18 | med | mitigated | Live OpenCode model turns blocked by local provider errors |

## F-1 — Shell-metacharacter fixture exceeds the notice title contract

**Valid:** dated 2026-11-18

**Observed:** Original `cargo test --locked` exits101 in `call_args_with_shell_metachars_are_literal`: CLI reports `title over the limit:169 exceeds120`, exit2 instead of0. Title repeats the absolute temporary path three times. `Env::call` passes JSON on stdin; the test never reaches the literal-transport assertions in this environment.

**Impact:** Environment-dependent false failure; keep production title validation and move the long absolute marker to the body, retaining shell metacharacters in both fields and checking stored values and absence of side effects.

**Evidence:** `/tmp/pr19-original-cargo.log`; `tests/opencode_caller.rs` test and `impl Env/call` read.

**Status:** fixed-verified — short metacharacter title plus absolute side-effect marker in body; targeted test now passes without changing the production title limit. Full reconciled Rust suite also passed before the final CLI contract regression was added.

## F-2 — PR predates repository-scoped session listings

**Valid:** dated 2026-11-18

**Observed:** PR19 server tool has no list arguments and shared `tools::list_sessions` renders all discovered sessions. Current main0.2.8 has `ListSessionsArgs {all:false}`, repository scoping through `split_by_repo`, hidden-count and unknown-repo explanations, plus schema regression. Main merge conflicts in server.rs, tool schema, sessions command and installer.

**Impact:** Choosing the older side would remove a released public tool contract. Preserve repository scoping and all=true across MCP and OpenCode wrappers; test caller repo and all override.

**Status:** fixed-verified — moved ListSessionsArgs and repository filtering to the shared tool body; MCP and OpenCode CLI forward args, plugin schema exposes all. New default/unknown-caller tests observed red (0/2); helper tests now pass3/0, pinned public schema passes. Added CLI and JS forwarding regressions; focused verification in progress. CLI may legitimately discover additional local Codex/Claude sessions, so its assertion pins foreign-session exclusion and the hidden-session explanation; exact count is pinned in the controlled helper test.

## F-3 — Caller lookup does not validate the returned session identity

**Valid:** dated 2026-11-18

**Observed:** Independent scratch probes accepted both Null and a different data.id as a live caller. Our new caller_requires_exact_live_row_at_every_parent_hop test fails on Null (0 passed,1 failed), /tmp/pr19-identity-red.log. A cached discovery row is insufficient when the fresh lookup does not confirm the requested id; validate every parent hop.

**Status:** fixed-verified — exact requested id is required at every lookup hop. New caller regression observed red then green, including missing/null/mismatched responses and parent hops.

## F-4 — Send deadline does not bound API awaits

**Valid:** dated 2026-11-18

**Observed:** Independent 3s delayed enqueue and observation exceed timeout_s=1. Our pending-API regressions for preflight, enqueue and observation all fail the external 3s bound (0 passed,3 failed), /tmp/pr19-send-budget-red.log. Production per-call CLI10s bound is not the total send budget. Apply the remaining deadline to every await; retain unknown after uncertain enqueue and queued after accepted enqueue, without retry.

**Status:** fixed-verified — one deadline covers preflight, enqueue and observation. All three pending-API regressions observed red then green; preflight never posts, uncertain enqueue stays unknown, accepted enqueue stays queued and is never retried.

## F-5 — Cancellation during fork creation drops cleanup ownership

**Valid:** dated 2026-11-18

**Observed:** Independent delayed-response fake allocates a fork before replying. Timeout or cancellation of ask before the reply drops the creation future before ForkGuard exists; allocated=true, removed=false, cleanup registry reports complete. Both probes fail in /tmp/pr19-review-mutations/session-bridge/mcp-server/tests/review_creation_probes.rs.

**Impact:** An owned fork can remain after a cancelled or timed-out request. Own creation before its first API effect, let the response arm a guard even after request drop, and drain cleanup waves under a bounded shutdown budget. A truly lost response still cannot identify the remote fork and must remain explicit uncertainty.

**Status:** fixed-verified — tracked creator hands off armed guard; cancelled/timed-out requests retain cleanup ownership. Normal CLI and signal exits drain creators and all cleanup waves under one budget. Late reply, cancellation, normal timeout and blocked DELETE regressions pass; ownership, wave and CLI-drain mutants are killed.

### Follow-up — normal CLI exit and cleanup waves

The owned creator alone does not survive runtime shutdown. Reviewer identified call_until_signal returning immediately on normal timeout. New call_timeout_drains_late_fork_creation_before_process_exit observed red, then green after normal and signal paths both drain before exit. Evidence /tmp/pr19-cli-creation-red.log and -green.log.

An actually applied mutation stopping await_fork_cleanups after its first batch survived the initial new ask test. That test waited for eventual deletion separately and did not prove the waiter's contract. Strengthened fake now blocks DELETE, starts drain before the creation reply, asserts drain remains pending during the second wave, then releases DELETE and checks completion. Whole ask suite15/0 green; follow-up mutant rerun pending.

## F-6 — Notice routing trusts payload cwd instead of verified session directory

**Valid:** dated 2026-11-18

**Observed:** Independent probe and local hook_repository_comes_from_the_verified_session_directory test fail when nonempty payload.cwd differs from API target.directory. Session-start persists the payload directory. New test also covers missing and relative target directories with a matching session id, rather than an earlier identity rejection.

**Status:** fixed-verified — hook always uses verified absolute target.directory; missing/relative directories have no state effects. New regression observed red, then complete hook suite green.

## F-7 — MCP all-repository argument forwarding lacks a regression guard

**Valid:** dated 2026-11-18

**Observed:** Reviewer applied server.rs forwarding mutation args -> ListSessionsArgs::default(); it survived both helper tests and the complete existing Rust suite (excluding only new intentionally failing review probes). Evidence /tmp/pr19-review-mutations/mutation-results/M14_mcp_all_forward_full.diff and .log. Independent score14 compiling distinct candidates,13 killed and1 survived; invalid compile attempts excluded.

**Impact:** Helper/CLI/JS guards do not cover the MCP call site. Extend actual stdio MCP fixture with a foreign repository and assert default exclusion plus all=true inclusion through tools/call.

**Status:** fixed-verified — actual stdio fixture with foreign repo C now kills the previously surviving MCP forwarding mutation, confirmed by independent rerun.

## Validation — 2026-11-18

After review fixes: complete Rust suite383 passed,0 failed (36 cargo result records), fmt and Clippy all-targets -D warnings clean. OpenCode adapter207 passed,0 failed before Rust-only fixes. Actual stdio MCP fixture includes caller repo A/B and foreign repo C; default excludes C and all=true includes it. Independent initial review applied14 compiling distinct mutation candidates:13 killed,1 MCP forwarding survivor; follow-up mutation checks are running.

Fresh isolated OpenCode2.2.7 service loaded the current plugin and registered session-bridge-reader. Real permission API returned deny for shell/write/edit/patch/codescout_run_command/codescout_edit_code/session_bridge_send_message, allow for read. Disposable session deleted, API list confirmed0 remaining, private server stopped. Evidence /tmp/pr19-live-w1ta9d7u/permission-evidence.json. This proves runtime permission decisions only. Empty sessions cannot be forked, and resume=false synthetic messages did not establish history; no model turn or full cross-harness smoke was run. The original author also did not load the changed plugin in their long-running service. Spec acceptance6 remains open.

### Follow-up review and environment checks

Independent fix review applied10 distinct candidate behaviors. Initial cleanup-wave guard survived; after strengthening the blocked-DELETE test it was killed. Latest execution for each of the10 candidates was killed, including MCP forwarding, creator registration and normal CLI cleanup. Exact diffs/logs at /tmp/pr19-review-fixes/fix-mutations. No remaining blocking finding from that review.

Root suite in inherited temporary environment reported failures in test-cross-platform-hooks.sh, test-skill-hints-lib.sh and constitution-epoch-bump.test.sh. Rerunning all three with a private TMPDIR under /tmp returned exit0 for each. Empty foreign /tmp/.git and cc-tmp/.git marker directories were removed only after checking plain-directory/empty status; nonempty markers were preserved. No unrelated fixture changes were imported from the concurrent main checkout. Whole root run still pending at this note.

### Published review and final archive follow-up

Review fixes published as9d3907a663edbda33a1b944e1dcfc1b0aaf08c8c; all5 fresh CI checks passed: https://github.com/mareurs/claude-plugins/actions/runs/44335457980. Local root run completed with exactly3 failed groups already listed; all3 passed in isolated TMPDIR reruns. Do not relabel that original full run green.

The final archived-session follow-up passes the complete Rust suite385/0, fmt and Clippy all-targets -D warnings. Two archive-guard mutants were independently killed after a31-test focused baseline. No remaining blocking findings in reviewed code fixes; real cross-harness spec acceptance6 still open, so no merge recommendation yet.

At the user's request, Alexandre received detailed, constructive explanations of the issues, fixes, observed surviving mutations and reusable agent prompts for inexpensive targeted mutation checks: PR16 https://github.com/mareurs/claude-plugins/pull/16#issuecomment-6983069234 and PR19 https://github.com/mareurs/claude-plugins/pull/19#issuecomment-6983069843. PR16 is merged; PR19 remains open. No owner blame or junior label was included.

## F-8 — Default OpenCode listing includes archived sessions

**Valid:** dated 2026-11-18

**Observed:** Follow-up live API probe on an isolated OpenCode2.2.7 service created then archived a disposable session. GET /api/session?limit=100 included it; archived=true also included it; archived=false excluded it. discover_opencode has no archived-row filter, despite the documented exclusion. Evidence /tmp/pr19-live-w1ta9d7u/archive-evidence.json. Probe session deleted and private server stopped.

**Impact:** Archived sessions may be listed/targetable and count as live callers. Filter archived rows after merging paged and active-lookup results; do not rely on an API default.

**Status:** fixed-verified — discovery and fresh-caller archived regressions observed red then green. Nonnull time.archived is excluded; null restored markers remain accepted. Independent review baseline31/0; removing either archive guard was actually applied and killed (2 attempted,2 killed,0 surviving,0 invalid). Evidence /tmp/pr19-archive-review-report.md and /tmp/pr19-review-archive/archive-mutations/.

## F-9 — Live OpenCode model turns blocked by local provider errors

**Valid:** dated 2026-11-18

**Observed:** Initially both local completion models returned HTTP500. After the user's request to retry, qwen3.8-27b-ud-q4_k_xl-auto returned HTTP200 with final content READY. The 4B model still returned500. A private OpenCode config selected the functioning 27B model; no user provider settings were changed.

**Resolution:** All required live bridge paths were exercised with actual model tool calls on runtime head `8135318`, including child caller resolution. See the provider-retry section and portable evidence JSON for the precise enforcement and delivery observations.

**Status:** mitigated — inference works through 27B; the remaining 4B provider failure does not block bridge acceptance.

## Provider retry — 2026-11-18, runtime head 8135318

The user requested another attempt after restoring the backend. 27B returned final READY; the private OpenCode service then used that model. The four tools were observed in the actual provider request, not inferred from model prose. A fresh session successfully called list/ask/send/post_notice through the current plugin. No product code changed in this continuation.

| Flow | Observed result |
| --- | --- |
| OpenCode model list | Real tool call; returned caller address marked `(you)` |
| OpenCode child caller | Child ses_e1058a8a5ffenliV7dPaYvaqCX called list once and completed; hook saw the child ID; output marked its real parent ses_e1058e9c5ffeGJSjtAM6YEIOlz as `(you)` |
| Claude MCP → OpenCode send | Exact message msg_sb18e932ef89e209ff24b5681 observed in original session; actual target model answered ACK-852 |
| OpenCode model → Claude ask | Answer PR19-CLAUDE-SEED-963; source transcript SHA256 identical before/after |
| OpenCode model → Codex ask/send | Ask returned PR19-CDX-SEED-852; stable ask-only source hashes identical; native queued send observed and target model answered ACK-741 |
| Claude MCP → OpenCode ask | Answer recalled PR19-OC-SEED-927; original messages identical; no probe files; fork removed |
| Claude notice → OpenCode | Live execute.after hook appended PR19-CLAUDE-NOTICE-461; following provider request contained it as tool-result data |

Read-only enforcement was measured in two ways: the actual ask fork context exposed only glob/grep/read/skill, and native permission requests denied write/edit/shell/bridge-post-notice for the registered reader while allowing them for build. The model reported the forbidden tools absent, so it could not issue a forbidden call. This proves exclusion and permission enforcement; it does not claim a model-issued execution that never occurred.

Measurement corrections: an initial sender-model claim of missing tools was not accepted as API evidence; a fresh session plus request observer established actual registration/calls. One Codex hash sample overlapped the deliberately queued send and was discarded; a separate ask-only run matched hashes. The earlier provider-failure JSON is retained as historical and points to the successful retry JSON.

Cleanup: zero sessions remained in the private service before shutdown; private OpenCode/Claude processes exited, private Codex daemon stopped, private Codex home and copied auth/provider config removed, observer proxy stopped. Native disposable Claude transcripts remain for audit. Raw private proofs: /home/marius/.cache/cc-tmp/pr19-live-retry-dtcujln6. Portable evidence: docs/evidence/2026-11-18-pr19-opencode-provider-retry.json.

Runtime head `8135318` has 390 passing Rust tests, 207 passing adapter checks, clean fmt/Clippy, passing root-suite/version checks and all five CI jobs successful (run `44351853249`). This continuation only adds evidence/docs. Review is ready for integration; PR19 remains open pending explicit integration authorization.

## Live acceptance continuation — 2026-11-18

Tested code head8dcdc4c1f0db9b5f2447b2c3f07f48e5404da34d with Claude2.1.327, Codex0.169.0 and a fresh private OpenCode2.2.7 service loading the current plugin from this worktree. Disposable root /tmp/pr19-live-acceptance-7btoc4mi; temporary config/data/state, provider config/auth copied privately, native Claude/Codex accounts used for short disposable turns. No shared service restarted.

| Flow | Observed result | Scope of proof |
| --- | --- | --- |
| Claude MCP → OpenCode send | Exact bridge message recorded in original OpenCode user history, status observed | Actual Claude model tool call through MCP; OpenCode model reply blocked by provider500 |
| OpenCode identity CLI → Codex send | observed, target model replied ACK-285 | Real managed daemon under disposable CODEX_HOME; explicit legacy-history thread, original thread, no remote/queue wrapper |
| OpenCode identity CLI → Claude ask | Correct PR19-CLAUDE-SEED-963 marker | Real read-only Claude fork; stable before/after original transcript hashes equal |
| OpenCode identity CLI → Codex ask | Correct PR19-CDX-SEED-852 marker | Real ephemeral fork, distinct fork id, original transcript bytes unchanged |
| Claude MCP → notice → OpenCode context | Marker PR19-CLAUDE-NOTICE-396 present in the target's actual context.system event | Current plugin hook observed by a separate diagnostic plugin; does not claim an LLM answer |
| Claude MCP → OpenCode ask, timeout | Explicit3s timeout, original message history unchanged,0 marked ask forks remaining | Real service fork/switch/prompt/interrupt/delete failure path; successful answer/write-denial model turn not established |

The first Claude-history hash comparison overlapped a legitimate post_notice turn and is invalid as isolation evidence. The repeated measurement with no concurrent original turn had equal hashes. This avoids attributing ordinary original-session activity to the fork.

Provider blocker is F-9. Direct OpenCode model-driven tool calls (including subagent caller shape) and successful Claude→OpenCode answer with model-attempted write/exec denial remain unverified. Existing permission-API denial evidence and unit/mutation checks do not replace those flows.

Evidence: oc-send-codex.json, oc-ask-codex.json, codex-original-history-proof.json, oc-ask-claude-stable.json, claude-original-history-stable-proof.json, notice-context-proof.json, oc-timeout-proof.json and the disposable session event logs under the private root. Raw credentials/config are not publishing artifacts.

While probes ran, origin/main advanced to69db24297dc5d30428e4d7f6a0adf2ba7b50d7d2 (released session-bridge0.2.9, companion1.22.4 and authentication/fixture/Codex fixes). Merged that published main into the review worktree without conflicts, preserving peer main-checkout WIP. Combined-tree checks pending at this note.

### Cleanup and combined-tree verification

OpenCode API list confirmed0 remaining disposable sessions before shutdown. Private OpenCode and Claude PIDs were then absent; private Codex daemon reported stopped, and no process retained the disposable CODEX_HOME. Removed the private Codex home and copied OpenCode auth/provider config. Native Claude source/fork transcripts remain in the profile for audit; no active probe session remains. cleanup-proof.json records the measured predicates.

Combined-tree Rust390/0, fmt, Clippy all-targets -D warnings and OpenCode adapter207/0 completed exit0. Full root hook/skill suite with private TMPDIR completed exit0 (All suites passed). Version consistency passed. PR delta against origin/main is whitespace-clean; imported upstream patch context lines were preserved. Original CI run44337579933 passed all5 checks on8dcdc4c before current-main reconciliation; the reconciled head gets fresh CI.

## Template for new entries
Record observed evidence, impact and verification.
