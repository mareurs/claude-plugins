# Codex background wake support for 0.167.0

Status: approved by the user on 2026-11-10; implementation and validation in progress.

## Intent

Allow the background-wake adapter to support the installed Linux Codex CLI and daemon 0.167.0, with evidence that secondary attachment preserves the original client's tool and permission callbacks. Prepare a focused upstream PR. Keep existing local modifications and installed plugins untouched during development.

## Observed failure

At upstream commit 0ed760d952db3da3370f0a8da31d3bdf57ff36bf, adapters/codex.mjs accepts only declared and observed daemon 0.160.0, while intake.mjs accepts only native Codex hook version 0.165.0. The local daemon reports codex-tui/0.167.0. Installing ws does not resolve these gates. Existing native evidence belongs to the older versions and must remain labeled as such.

## Approaches

The user selected bounded support for verified 0.167.0 plus a reusable compatibility test. This limits the compatibility claim to measured versions. An automatic capability negotiation system for arbitrary future versions was considered but deferred because it changes the trust model and needs broader design and validation. Removing all version checks is excluded because it would accept unmeasured callback-routing behavior.

## Change

Add a reusable, opt-in native compatibility probe using a dedicated temporary test thread and primary/secondary clients. Verify loaded-thread attachment, original tool callback ownership and original permission callback ownership after secondary close, and no callbacks delivered to the secondary. Capture only a sanitized evidence summary; do not commit credentials, transcripts, real thread IDs or socket identities. Bound execution and close probe-owned resources. Never attach to or send into existing user threads.

When that probe succeeds for daemon 0.167.0, add this measured version to the daemon compatibility gate and add the verified native 0.167.0 hook envelope to intake compatibility. Match declared and observed daemon versions; do not accept a mismatched or unknown version. Preserve profile ownership, socket-generation pinning, explicit opt-in, root/child discrimination, duplicate suppression and legacy 0.160.0/CLI 0.165.0 behavior.

## Acceptance

- A new automated regression reproduces rejection of the 0.167.0 combination before implementation, then passes after the fix.
- Old measured versions still pass; unknown versions, mismatched declarations, wrong profiles, stale generations and child-origin events remain rejected.
- A native probe on 0.167.0 records at least one original tool callback, at least one original permission callback, and zero secondary callbacks. Missing observations are inconclusive, never a pass.
- Native root and child hook shape for 0.167.0 is captured or verified before enabling intake support; synthetic fixtures are clearly labeled.
- Relevant background-wake tests and repository checks pass, with any baseline failures distinguished.
- Documentation states the exact measured versions and remaining automatic-delivery limits. No version bump or release is included.

## Boundaries

A live model-backed compatibility probe may consume account usage. Its concrete request and limit will be presented before execution if needed. Local tests and implementation are authorized. Commit, push and PR publication require approval of the exact prepared result under the user's standing rules. Activation in the installed Codex profile follows only after successful verification and retains a fresh configuration backup.
