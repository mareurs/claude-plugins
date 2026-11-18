---
id: '932f13a3d4986e30'
kind: report
status: active
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

These results establish callback routing after an actually started turn. Native root/child hook envelopes, automatic wake delivery, installed profile rollout and complete repository checks are separate. The final whole-repository release preflight is pending. The reviewer also declined to judge pre-existing RPC/completion handling outside this change.

The complete fixture inventory included native and cleanup callers omitted from the structural references result; successful fixtures now emit native-style start notifications. The cleanup fixture asserts actual tool success and approval decline before observing archive failure, preventing a startup failure from masquerading as cleanup coverage.
