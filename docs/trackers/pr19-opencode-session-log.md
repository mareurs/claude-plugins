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
entry_high_water_F: 2
---

## Scope
Systematic review of PR #19. Original head: `28c93b458dc421f7ea892b683aae9b0de61610a2`. Source specification: `docs/superpowers/specs/2026-11-17-session-bridge-opencode-design.md`. Preserve concurrent main-checkout work.

## Index
| ID | Date | Severity | Status | Finding |
| --- | --- | --- | --- | --- |
| F-1 | 2026-11-18 | med | fixed-verified | Shell-metacharacter fixture exceeds the notice title contract |
| F-2 | 2026-11-18 | high | mitigated | PR predates repository-scoped session listings |

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

**Status:** mitigated — moved ListSessionsArgs and repository filtering to the shared tool body; MCP and OpenCode CLI forward args, plugin schema exposes all. New default/unknown-caller tests observed red (0/2); helper tests now pass3/0, pinned public schema passes. Added CLI and JS forwarding regressions; focused verification in progress. CLI may legitimately discover additional local Codex/Claude sessions, so its assertion pins foreign-session exclusion and the hidden-session explanation; exact count is pinned in the controlled helper test.

## Template for new entries
Record observed evidence, impact and verification.
