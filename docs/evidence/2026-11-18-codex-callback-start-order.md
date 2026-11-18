---
id: '932f13a3d4986e30'
kind: report
status: done
title: Codex callback startup race evidence and review
tags:
- codex
- callback
- verification
---

# Codex callback startup race — 2026-11-18

The probe attached a secondary client after `turn/start` acceptance, before the matching `turn/started` notification. In an owned stock0.169 daemon initialized first as `codescout_background_wake`, acceptance occurred at597ms, secondary resume failed with `list_turns is not supported yet` at606ms, and the actual start arrived at613ms. Holding only resume until the own start event changed the native result to success. The shipping probe now waits for the owned thread and returned turn identity, retaining events received before the response, with one deadline shared by startup and completion.

## Verification

Before the production edit, the new nine-test suite had5pass/4fail, including deferred/missing/wrong-thread/wrong-turn starts. After repair, focused probes32/32 and sequential wake241/241 passed. A fresh reviewer applied12 distinct mutations:7test failures,2outer process timeouts,3survivors. The three survivors covered post-response foreign-turn correlation, deadline cleanup and resetting the completion budget. Only after observing survival were three regression tests added. Reapplying each exact candidate produced34pass/1fail in the corresponding regression; restored suite35/35. Final integrated complete sequential wake suite244/244 also passed. Production code was unchanged by the review follow-up. [Machine evidence](2026-11-18-codex-callback-start-order.json).

Actual direct private-socket probes, without the diagnostic proxy and with preliminary first-client initialization, passed on both stock `/usr/bin/codex`0.169.0 and the native-approval repair candidate0.169.0. Each observed1original permission callback,1original dynamic callback,0secondary callbacks and completed the turn. Each archived its owned thread and removed its private profile/socket. Existing user profiles were untouched.

## Limits and integration

These results establish callback routing after an actually started turn. Native root/child hook envelopes and automatic wake delivery remain separate. The complete `./tests/run-all.sh` command passed in the clean release worktree at `ab6befc`. The following `8051c07` delta changed only buddy test fixtures, their containment runner and documentation; all579 buddy tests and the explicit ancestor-write assertion passed after that delta. Both local releases used that composed preflight; Session Bridge cargo tests, Clippy and installation also ran during its release. No claim is made that the entire repository command was rerun at `8051c07`.

The actual installed Codex cache1.22.4 then passed a direct stock0.169 callback probe and adapter capability check after initialization as `issue14_first_originator`. It recorded one primary tool callback, one primary approval callback, zero secondary callbacks and completed the owned turn. [Installed-cache proof](2026-11-18-installed-cache-native.json). A fresh post-restart focused rerun passed35/35; canonical versions and all installed Claude profile paths/caches passed parity. The reviewer declined to judge pre-existing RPC/completion handling outside this change.

The complete fixture inventory included native and cleanup callers omitted from the structural references result; successful fixtures now emit native-style start notifications. The cleanup fixture asserts actual tool success and approval decline before observing archive failure, preventing a startup failure from masquerading as cleanup coverage.
