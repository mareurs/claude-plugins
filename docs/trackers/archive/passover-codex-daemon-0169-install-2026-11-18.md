---
id: 488e460c5575fc73
kind: tracker
status: archived
title: Passover — Codex 0.169 daemon activation — 2026-11-18
tags:
- passover
- codex
- installation
topic: codex-daemon-0169-install
time_scope: dated:2026-11-18
archived_on: 2026-11-25
branch: main
---

# Passover — Codex 0.169 daemon activation — 2026-11-18

## State

User explicitly requested installing0.169 and then selected activation only when other turns become inactive. A complete0.169 CLI with the reviewed issue15 native approval patch has been built and packaged. Private packaged-CLI callback and actual native decline/accept probes passed. Detached upgrade worker3513271 is monitoring the real shared daemon; at17:27:39Z it was waiting for5 other active turns,0 unknown statuses. The daemon was still0.160.0. The authoritative live state is /home/marius/.cache/cc-tmp/codex-daemon-install-0169-20261118/install-journal.json; do not infer activation from the package version or from this dated snapshot.

## Next actions

1. Verify current git status, the durable install journal, worker PID/cmdline, and actual codex app-server daemon version before acting. The watcher may have completed after this handoff.
2. If still waiting, preserve the user's idle-only condition. Do not start another worker or restart active turns. Worker log and package/proofs are beside the journal.
3. If installed-and-verified, independently read the actual managed binary version/hash, installed-callback-proof.json, adapter result and per-profile wake binding. Expected full CLI SHA256 is8fb179ffbdbf489d55baef03323ee09e97f032368c4271de475d9d8f1a64c173. Record the actual activation result in repository evidence/memory and report it to the user.
4. If failed/rolled-back/rollback-failed, inspect worker.log, daemon-update.log, trust-refresh.log and rollback logs. Stop at the measured failure; do not blindly re-run or replace a concurrently changed installation.
5. Finish with scoped verification/documentation commits, preserving peer changes; consume this passover through doc status archived plus a dated Consumed section, then doc move to docs/trackers/archive/.

## Working state

- Main at7382d04 when the deployment was prepared; peer hook/Session Bridge source edits remain dirty. Our tracker F-10 is fixed-verified and awaiting an audit commit.
- KEEP /home/marius/.cache/cc-tmp/codex-daemon-install-0169-20261118/package: complete custom CLI0.169 with bin/codex, unchanged candidate code-mode helper, packaged rg/bwrap/proxy. Build exited0 in6m29s using the native target cache.
- KEEP /home/marius/.cache/cc-tmp/codex-daemon-install-0169-20261118/previous-release: full0.160 rollback package; original settings/config copies are private. Directory permissions700.
- KEEP /home/marius/.cache/cc-tmp/codex-daemon-install-0169-20261118/managed-upgrade.mjs and refresh-existing-hook-trust.py: one detached worker, PID3513271. It requires two idle readings, refreshes only exact already-trusted unchanged hook declarations, rechecks idle, uses native daemon update --from-cli -y, verifies actual version/binary, runs a fresh proof on the actual profile and refreshes only that profile's wake generation/capability. Failure after selecting its own binary triggers rollback.
- KEEP approval-preflight.json and callback-preflight.json: actual complete-package positive evidence. Initial untrusted-fixture failure is preserved separately; F-10 explains the corrected precondition.
- No repository production source changed for this installation. External Codex source retains its existing patch, build-normalized Cargo.lock and bootstrap metadata; do not clean it.
- Only lowercase ~/.codex exists here. All three uppercase profiles are absent. No missing profiles were created.
- .codescout/cc_session_id names a peer; origin_session_id is deliberately omitted. Actual requester thread is in the journal.

## Anti-goals

- Do not invoke stock /usr/bin/codex update --from-cli: that would install the unpatched host. Use the complete prepared package.
- Do not substitute the standalone codex-app-server candidate for the complete CLI entrypoint.
- Do not bypass native approvals or change enabled hook flags. Existing0.160 marks34 hooks trusted;0.169 requires refreshed content hashes for buddy/companion. The worker only migrates already-trusted unchanged declarations and preserves enabled flags and cache bytes. Buddy's older installed runtime was inspected and is preserved.
- Do not interrupt other active turns; user explicitly chose waiting.
- Do not claim automatic wake delivery from callback preservation.
- Do not close GitHub15 merely because the local custom host works; stock CLI0.169 still has the upstream issue.

## Pointers

- docs/patches/2026-11-18-codex-0.169.0-native-approval-hook-payload.patch
- docs/evidence/2026-11-18-codex-native-approval-0169-patch-check.json
- session-bridge-codex-session-log:F-10
- /home/marius/.cache/cc-tmp/codex-daemon-install-0169-20261118/install-journal.json

## Consumed — 2026-11-25

Tracker-hygiene sweep 2026-11-25 consumed this passover without executing it. The install journal named in Pointers no longer exists. The installed Codex CLI is `0.171.0`, and the app-server daemon process started on 2026-11-23, after this handoff. The 0.170 work (`session-bridge-codex-session-log:F-11`, `F-12`) came after it. No step here can run as written.
