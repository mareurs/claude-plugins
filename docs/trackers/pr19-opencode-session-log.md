---
id: '123777f0a66237ba'
kind: tracker
status: active
title: PR19 OpenCode session-bridge audit
tags:
- pr19
- opencode
- review
topic: pr19-opencode
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Status | Finding |'
entry_high_water_F: 7
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

## Template for new entries
Record observed evidence, impact and verification.
