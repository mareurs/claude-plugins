---
id: '8e335a24a30e476d'
kind: report
status: done
title: Callback start-order spec drift verification
tags:
- codex
- callback
- verification
---

# Callback start-order spec drift

SPEC DRIFT: Codex callback probe waits for actual turn start

Spec: docs/superpowers/specs/2026-11-18-codex-callback-start-order-design.md (id 1e4f8ea57dbb90e2)

Verdict: GO

Implemented: 29/29; Missing: 0; Divergent: 0.

[implemented] Wait for the primary's turn/started notification matching both owned threadId and the turnId returned by turn/start, before opening/attaching the secondary.

Evidence: tools/probe-codex-wake-callbacks.mjs:62; tools/probe-codex-wake-callbacks.mjs:87; tools/probe-codex-wake-callbacks.mjs:90

[implemented] Handle a matching notification arriving before the turn/start response.

Evidence: tools/probe-codex-wake-callbacks.mjs:63; tools/probe-codex-wake-callbacks.mjs:89; tools/probe-codex-wake-start-order.test.mjs:63

[implemented] Unrelated thread notifications never unblock the wait.

Evidence: tools/probe-codex-wake-callbacks.mjs:62; tools/probe-codex-wake-start-order.test.mjs:67

[implemented] Unrelated turn notifications never unblock the wait.

Evidence: tools/probe-codex-wake-callbacks.mjs:64; tools/probe-codex-wake-start-order.test.mjs:111

[implemented] Keep one shared bounded timeout for startup and completion.

Evidence: tools/probe-codex-wake-callbacks.mjs:82; tools/probe-codex-wake-callbacks.mjs:90; tools/probe-codex-wake-callbacks.mjs:99; tools/probe-codex-wake-start-order.test.mjs:138

[implemented] A missing start times out.

Evidence: tools/probe-codex-wake-callbacks.mjs:90; tools/probe-codex-wake-start-order.test.mjs:67; fresh focused35/35

[implemented] Cleanup interrupts only the owned turn.

Evidence: tools/probe-codex-wake-callbacks.mjs:106; tools/probe-codex-wake-start-order.test.mjs:83

[implemented] Cleanup archives only the owned thread.

Evidence: tools/probe-codex-wake-callbacks.mjs:107; tools/probe-codex-wake-start-order.test.mjs:103

[implemented] Timers are cleaned.

Evidence: tools/probe-codex-wake-callbacks.mjs:103; tools/probe-codex-wake-start-order.test.mjs:117

[implemented] Sockets are cleaned.

Evidence: tools/probe-codex-wake-callbacks.mjs:104; tools/probe-codex-wake-callbacks.mjs:109

[implemented] Preserve early-callback rejection.

Evidence: tools/probe-codex-wake-callbacks.mjs:61; tools/probe-codex-wake-start-order.test.mjs:76

[implemented] Preserve original approval decline.

Evidence: tools/probe-codex-wake-callbacks.mjs:60; tools/probe-codex-wake-start-order.test.mjs:38

[implemented] Preserve secondary-callback rejection.

Evidence: tools/probe-codex-wake-callbacks.mjs:93; tools/probe-codex-wake-callbacks.mjs:13

[implemented] Preserve profile validation.

Evidence: tools/probe-codex-wake-callbacks.mjs:71

[implemented] Preserve version validation.

Evidence: tools/probe-codex-wake-callbacks.mjs:70

[implemented] Preserve one-thread/one-turn accounting.

Evidence: tools/probe-codex-wake-callbacks.mjs:73; tools/probe-codex-wake-callbacks.mjs:86; tools/probe-codex-wake-start-order.test.mjs:53

[implemented] A server-returned error is never retried.

Evidence: tools/probe-codex-wake-callbacks.mjs:101; tools/probe-codex-wake-start-order.test.mjs:91

[implemented] A server-returned error is never converted to supported.

Evidence: tools/probe-codex-wake-callbacks.mjs:101; tools/probe-codex-wake-start-order.test.mjs:91

[implemented] Update synthetic fixtures to emit native-style turn/started.

Evidence: tools/probe-codex-wake-start-order.test.mjs:16; docs/evidence/2026-11-18-codex-callback-start-order.md:1; focused35/35

[implemented] Tests deterministically reproduce response-before-start ordering.

Evidence: tools/probe-codex-wake-start-order.test.mjs:26; tools/probe-codex-wake-start-order.test.mjs:53

[implemented] Tests pin correlation.

Evidence: tools/probe-codex-wake-start-order.test.mjs:67; tools/probe-codex-wake-start-order.test.mjs:111

[implemented] Tests pin missing start.

Evidence: tools/probe-codex-wake-start-order.test.mjs:67

[implemented] Tests pin completion timeout.

Evidence: tools/probe-codex-wake-start-order.test.mjs:83; tools/probe-codex-wake-start-order.test.mjs:138

[implemented] Tests pin early callbacks.

Evidence: tools/probe-codex-wake-start-order.test.mjs:76

[implemented] Run focused wake checks.

Evidence: fresh node --test --test-concurrency=1 tools/probe-codex-wake*.test.mjs:35pass/0fail; docs/evidence/2026-11-18-codex-callback-start-order.json:1

[implemented] Run full wake checks.

Evidence: docs/evidence/2026-11-18-codex-callback-start-order.json:1 — final sequential244/244

[implemented] Run repo checks.

Evidence: docs/evidence/2026-11-18-codex-callback-start-order.md:1 — full run-all at ab6befc, later test-only buddy579/579+ancestor containment; fresh versions and all-profile parity exit0

[implemented] Re-run direct stock0.169 native probe without a proxy, including preflight first-originator initialization.

Evidence: docs/evidence/2026-11-18-installed-cache-native.json:1 — actual installed1.22.4 stock0.169 first originator issue14_first_originator, primary callbacks1+1, secondary0

[implemented] No native automatic-wake claim without a separate test.

Evidence: docs/evidence/2026-11-18-installed-cache-native.json:33; docs/evidence/2026-11-18-codex-callback-start-order.md:1 — limitation retained

The native checks establish callback preservation and the adapter accepting a matching per-profile proof on0.169. They do not prove automatic wake delivery or native root/child hook envelopes. Repository preflight is composed from the complete run at ab6befc and the subsequent buddy test-only delta verification; it is not reported as a second complete run at8051c07.
