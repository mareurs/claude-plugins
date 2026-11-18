---
id: cc97050feea829a8
kind: tracker
status: active
title: Session bridge Codex session log
tags:
- session-bridge
- codex
- reconnaissance
topic: session-bridge-codex
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Category | Status | Title |'
entry_high_water_F: 8
entry_high_water_W: 1
---

# Session bridge Codex session log

Verified observations for the Codex interoperation work stream. Entries use the reconnaissance session-log conventions.

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|----------|----------|--------|-------|
| F-1 | 2026-11-16 | high | architectural | fixed-verified | Claude endpoint keys do not identify Codex threads |
| W-1 | 2026-11-16 | — | verification | validated | Installed-host smoke and applied mutations validate the bridge boundaries |
| F-2 | 2026-11-16 | high | host-contract | fixed-verified | Official Claude caller has a host session ID but no legacy IPC socket |
| F-3 | 2026-11-16 | high | attribution | fixed-verified | Inherited Codex variables can misattribute a nested Claude caller |
| F-4 | 2026-11-16 | med | measurement | fixed-verified | **Notice smoke checked before the bridge's 120-second look interval** — corrected window; native context consumption passed. |
| F-5 | 2026-11-18 | high | authentication | fixed-verified | Claude forks discard target settings auth and inherit caller credentials |
| F-6 | 2026-11-18 | med | host-contract | fixed-verified | **Callback probe attaches before actual turn start** — native control and event-held intervention distinguish acceptance from readiness. |
| F-7 | 2026-11-18 | med | test-environment | fixed-verified | **Linked dependencies invalidate cache independence** — use real production dependency files for release preflight. |
| F-8 | 2026-11-18 | med | test-isolation | fixed-verified | **Buddy pytest can pass while writing ancestor state** — seven failing cases plus five passing writers isolated and pinned by the containment runner. |

## Status vocabulary

Frictions: open, mitigated, fixed-verified, wontfix-false-alarm, promoted-to-bug-tracker, pinned-as-eval-baseline. Wins: validated, promoted-to-permanent-docs, archived.

## F-1 — Claude endpoint keys do not identify Codex threads

**Observed:** 2026-11-16 while preparing Codex interoperation.

**Expected:** Reusing the existing endpoint identity would preserve per-session routing.

**Got:** endpoints::discover reads only Claude sockets/registrations; server::calling_endpoint returns CLAUDE_CONFIG_DIR and parent PID; state::endpoint_path uses profile and PID. Read-only /proc inspection found one Codex app-server holding multiple distinct rollout UUIDs. Its sibling app-server held none. A process-only identity cannot distinguish those threads.

**Severity:** high — adapting hooks without changing identity would mix cursors, self-exclusion and author attribution between threads.

**Status:** fixed-verified

**Resolution:** Codex identities encode canonical config home plus thread UUID; state uses a deterministic thread profile and logical PID 0. Actual host PID/generation remains transport-only. Fixture tests and applied UUID/home/PID/caller/revalidation mutations verify these boundaries; see W-1.

**Valid:** dated 2026-11-16

**Rests on:** source bodies read in session-bridge/mcp-server/src/{endpoints,server,state}.rs and the actual /proc FD snapshot; draft docs/superpowers/specs/2026-11-16-session-bridge-codex-design.md.

## W-1 — Installed-host smoke and applied mutations validate the bridge boundaries

**Valid:** dated 2026-11-16

**Observed:** 2026-11-16. The complete bridge suite passed 287 tests, clippy --all-targets -- -D warnings passed, cargo fmt --check and git diff --check passed. Release build succeeded.

**Status:** validated

**Evidence:** .superpowers/sdd/2026-11-16-session-bridge-codex contains live-smoke evidence (managed 0.160 host; inherited context answer; original rollout hash and mtime unchanged; exact direct user record observed plus native reply) and negative-probe-os.json. The latter records an actual openat(O_WRONLY|O_CREAT|O_TRUNC) failure with EROFS, no marker created, and re-archiving of our test thread. Fake executable and real stdio MCP fixtures validate caller/home/thread isolation and hook JSON output; these fixtures do not establish hook trust acceptance or delivery on a separate desktop stdio host.

**Mutation results:** Independent review applied 15 distinct candidates. After regression fixes it observed 14 killed and one narrow assistant-role survivor. The parent added an assistant/input_text regression, applied that remaining mutation, observed the test fail with observed instead of queued, restored the role check and observed the test pass: all 15 reviewed candidates are now killed. This is a measured campaign, not exhaustive mutation coverage.

**Limits:** Normal hook trust/reconnection remains a user UI step. An unregistered Claude print-mode caller is explicitly refused; interactive caller smoke is recorded separately. No Codex source or executable was changed. No release/version bump or git commit was performed.

## F-2 — Official Claude caller has a host session ID but no legacy IPC socket

**Observed:** Real interactive Claude Code 2.1.325 could list the loaded Codex target, but send_message refused calling session identity. The process held no rollout FD and had no legacy cc-socks registration. An exec wrapper of its actual MCP child captured host-provided CLAUDE_CODE_SESSION_ID and CLAUDE_CONFIG_DIR. Existing caller_session ignores that identity and only accepts Claude socket ancestors.

**Severity:** high — the requested Claude Code → Codex path remains unusable for this installed official host despite fixture/managed-Codex success.

**Status:** fixed-verified

**Next:** Validate the exact host-provided session ID against a matching Claude ancestor, config root and bounded persisted transcript metadata. Preserve refusal for missing/ambiguous identity; do not select a recent/first session. Add sender fixture and real interactive red/green proof before claiming completion.

**Valid:** dated 2026-11-16

**Rests on:** .superpowers/sdd/2026-11-16-session-bridge-codex/claude-mcp-env.json, claude-host-snapshot.json, claude-interactive.txt; src/sessions.rs caller_session and src/endpoints.rs claude_pid_of.

## Official Claude verification follow-up

The real MCP child's parent did have a current per-PID registration, even without an IPC socket. The fix therefore reads that live registration for native Claude processes and ancestor caller detection; it does not adopt CLAUDE_CODE_SESSION_ID. Regression tests cover socket-less native discovery/caller attribution, current registration changes after /clear, non-Claude rejection and bridge-child exclusion. Own Claude ask/filter subprocesses are now tagged as internal.

The real interactive Claude 2.1.325 smoke then succeeded: list_sessions found the requested original Codex thread and send_message returned queued with message ID sb-1794828795733644958-2899021-0. The current target was busy, so consumption was not observed during the bounded window; no retry was performed. Separate disposable-target Codex smoke already observed exact delivery and a native reply. Raw evidence: .superpowers/sdd/2026-11-16-session-bridge-codex/claude-interactive.txt and claude-mcp-env.json. The final suite passes 291 tests after the nested-caller regression; clippy -D warnings and fmt/diff checks pass. The final release artifact is installed at ~/.cargo/bin/session-bridge and configured for ~/.codex. Successful managed-host observations are preserved in managed-host-passed.json alongside the failed probe evidence.

## F-3 — Inherited Codex variables can misattribute a nested Claude caller

**Observed:** Independent review built a valid native Claude ancestor plus current per-PID registration and a loaded Codex endpoint; inherited CODEX_THREAD_ID/CODEX_HOME caused caller_session to select Codex instead of the actual nearer Claude host. The new native_claude_ancestor_wins_over_codex_environment_but_explicit_metadata_still_wins regression reproduced that wrong identity before the fix.

**Severity:** high — wrong notice authors, self-exclusion and sender labels when Claude is launched from a Codex-origin shell.

**Status:** fixed-verified

**Resolution:** Explicit request thread metadata retains priority. Without it, validated Claude ancestry precedes inherited Codex variables, but walking stops at an intervening loaded Codex host so reverse nesting cannot attribute a Codex caller to an outer Claude. Invalid explicit metadata is still refused. Current per-PID registration remains authoritative after /clear.

**Evidence:** New regression red→green, plus actual deletion of the intervening-host stop: survived six tests before extending the regression; after extension it failed with the outer Claude identity instead of Codex. Restored guard passed. Independent native-host review also killed six applied discovery/caller/child-tag mutations; both child-tag mutants survived before their new subprocess-environment assertions. Independent reapplication of the original caller-precedence defect then failed 1 of 6 session tests; restoring the fix returned 6 passing tests.

**Valid:** dated 2026-11-16

**Rests on:** src/sessions.rs caller_session, src/endpoints.rs ppid_of/native_claude_endpoint, tests/sessions.rs nested-caller regression; bridge_code_review installed-host follow-up.

## F-4 — Notice smoke checked before the bridge's 120-second look interval

**Valid:** dated 2026-11-16

**Observed:** Post-restart native MCP listing resolves this task as self, and hooks/list reports all three bridge handlers enabled and trusted. The initial notice probes waited 5.5 seconds before their trigger and inspected before the 120-second look interval had elapsed. They returned NO_BRIDGE_NOTICE with unchanged last_look_ms; this measured an early check, not a broken hook. Native hook/completed events later confirmed UserPromptSubmit and PostToolUse completed. A later final trigger crossed the interval and populated pending/worker_pid, confirming the timing boundary.

**Status:** fixed-verified

**Verification:** Corrected native probe completed 2026-11-16T12:15:07Z: notice 4 received a relevant verdict with no fallback; UserPromptSubmit emitted its exact signal as context, the receiver replied BRIDGE_HOOK_NOTICE_20261116_A7, and delivered=[4]. Both owned threads were archived; the test notice was removed with its deletion tombstone. Evidence: notice-live-smoke.json. Product code was unchanged.

**Severity:** med

**Rests on:** hook.rs LOOK_INTERVAL_MS = 120_000 and on_trigger's due predicate; task-workspace notice-no-tool-smoke.json, notice-posttool-smoke.json, and notice-short-window-smoke.json. The final live test now waits 125 seconds before triggering and then waits for its own filter verdict. Its notification subscription filters exact own thread IDs; unrelated broadcasts are excluded from retained evidence.

**Cost:** Extra model probes came from a harness timing assumption. No product source change was justified by those early negative results. Temporary sender/receiver threads were archived and each test's notice was removed with an exact deletion tombstone.

## F-5 — Claude forks discard target settings auth and inherit caller credentials

**Observed:** 2026-11-18 live Codex ask_session calls to main:1951713 and stef:575289 succeeded; kat:1730572 returned `Failed to authenticate: OAuth session expired and could not be refreshed`. The kat profile has its OAuth token and ANTHROPIC_BASE_URL in user settings.env, while its credentials file contains no access/refresh token. Re-running the exact pinned Claude fork with those two target env values, keeping --setting-sources empty and strict MCP isolation, returned BRIDGE_KAT_WITH_PROFILE_ENV_OK. No token values were logged.

**Cause:** ask::fork_argv disables all settings sources and ask_with_bound sets only CLAUDE_CONFIG_DIR; ENV_REMOVED omits caller authentication variables. filter::call_model has the same boundary. Thus target settings auth is lost and a Claude caller's OAuth/API key or API address may be inherited, violating the target-profile billing contract.

**Scope:** restore only explicit target user-settings authentication values, scrub caller auth, keep hooks/MCP/project settings disabled. Verify actual child environment and live cross-harness calls.

**Status:** fixed-verified

**Verification:** Before the fix, the new subprocess-environment tests observed caller secrets in the child and accepted malformed settings. After the fix, `cargo test` and `cargo clippy --all-targets -- -D warnings` exit 0; formatting and diff whitespace checks pass. Live MCP tool results on the rebuilt release binary passed Codex→Claude (kat/main/stef), Codex→Codex, Claude stef→kat, Claude stef→Codex and Claude kat→main. These are real source/target calls, not simulated routing. The target kat settings token authenticated successfully without re-login. No active sdd target was available.

**Independent applied mutations:** Removing the ask callsite, removing the filter callsite, omitting target OAuth restoration, and omitting caller auth scrubbing each failed the subprocess suite. A fifth mutation accepting non-string auth values initially survived the related suites; after adding the numeric-token regression it failed (4 passed/1 failed), and restored source passed (5/0). All five observed candidates are now killed. The review copy's full suite was not claimed green: unrelated install_codex tests require scripts outside the copied crate; the full main-checkout suite passed.

**Deployment:** Rebuilt the release binary used by Codex. Installed the common cargo executable used by all four Claude profiles with `cargo install --path . --locked --force`; existing MCP processes retain the previous executable until reconnected. No credentials or profile settings were changed.

**Valid:** dated 2026-11-18

**Rests on:** session-bridge/mcp-server/src/ask.rs::fork_argv, ask_with_bound; src/filter.rs::call_model; live calls and controlled target-env reproduction above.

## F-6 — Callback probe attaches before an accepted turn actually starts

**Observed:** Installed stock0.169 control with preliminary codescout_background_wake initialization: turn/start response597ms, thread/resume error list_turns at606ms, turn/started613ms. Direct immediate-attach runner also failed with empty rollout metadata. Holding only the resume until own turn/started then passed native tool1/permission1/secondary0. Trace captures are sanitized under /tmp/codex-runtime-callbacks-20261118.

**Cause:** Probe treated turn/start acceptance as actual start/readiness. The app-server can accept the turn before its processing/persistence path runs; loaded/list alone does not make that pending first turn resumable. Real callback ownership is preserved once attachment succeeds.

**Scope:** Wait for the exact owned thread and returned turn's started notification, including notification-before-response order, with the same bounded timeout. Keep real attach errors and early callback failures. No blanket daemon-support or automatic-wake claim.

**Status:** fixed-verified

**Verification:** Integrated source passes focused35/35 and complete sequential wake244/244. Fresh reviewer actually applied12 mutations (7test failures,2outer timeouts,3survivors); each exact survivor was then caught by an added regression, and restored35/35 passed. Direct private-socket stock0.169 and repaired0.169 candidate probes each passed tool1/permission1/secondary0 with preliminary first-client initialization and owned cleanup. Evidence: docs/evidence/2026-11-18-codex-callback-start-order.{md,json}. Automatic wake and profile delivery remain separate.

**Valid:** dated 2026-11-18

**Rests on:** native baseline/first-client/wait-started sanitized traces; tools/probe-codex-wake-callbacks.mjs::probeCodexCallbacks; exact-tag thread_processor.rs::resume_running_thread and thread_lifecycle.rs::handle_pending_thread_resume_request.

## F-7 — Linked worktree dependencies break the cache independence check

**Observed:** The clean release worktree's complete preflight failed only `test-background-wake-package.sh`: copied cache `require.resolve('ws')` pointed outside the cache. The worktree dependency setup used a ws symlink to the main checkout; copy_plugin_tree deliberately preserves symlinks.

**Cause:** The controller reused linked dependencies for a package-copy verification that requires independent real files. This was test setup, not a production resolver defect.

**Correction:** Replaced only the owned ignored dependency links with a real copy. The exact package-independence suite then passed and git status stayed clean. The complete release preflight is being rerun; no bump/profile mutation occurred in the failed attempt.

**Status:** fixed-verified

**Valid:** dated 2026-11-18

**Rests on:** release worktree c682 dependency lstat/realpath; scripts/lib-copy-plugin.sh; tests/test-background-wake-package.sh; failed background32 and focused package retest.

## F-8 — Buddy fixtures inherit ancestor projects and leak state despite green assertions

**Observed:** After the complete shell/Node repository command passed at ab6befc, release's separate buddy pytest gate reported7fail/572pass under an ancestor .git. An owned ancestor reproduced the same seven failures and detected .buddy writes. Initial fixture corrections made579/579 pass, while the ancestor-state assertion still failed.

**Cause and measurement:** Per-test before/after filesystem snapshots then identified five additional passing tests that wrote ancestor state: three SessionStart helper tests and two migration subprocess tests. A green pytest result alone had not measured containment.

**Correction:** Four buddy test modules now declare owned project boundaries; the negative unmarked-filesystem unit explicitly masks only project marker predicates. New tests/test-buddy-fixture-isolation.sh runs all579 tests beneath a controlled enclosing project and verifies no ancestor state exists. Final run:579passed, ancestor untouched, exit0. No production buddy code changed.

**Status:** fixed-verified

**Valid:** dated 2026-11-18

**Rests on:** failed release background35; controlled RED37; assertion-only GREEN38 with containment failure; per-test trace39; full containment GREEN3a; /tmp/codex-runtime-callbacks-20261118/buddy-fixture-writes.json.

## Template for new entries

Entries are allocated and appended through doc append_entry. Each names its observation, evidence, validity and dependency.
