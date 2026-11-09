---
id: '3f373e14fa311cc8'
kind: plan
status: active
title: Stock Codex Identity and Operation Observations Implementation Plan
tags:
- codex
- session-identity
- observability
- implementation
approved_on: 2026-11-09
deployment: not included
execution_method: inline/native with independent final applied-mutation review
execution_progress: Tasks 1–7 source implementation and verification complete; final explicit-path commits pending. Full plugin and Codescout gates green, six native components passed, ten stock-native routes passed, formatter56 and buddy534 passed. Independent mutation review accepted after fixes; spec-drift source GO (57ada03063a50be6). No deployment.
final_review: Independent strongest-model review accepts source after fixes; six applied mutations, initial 5 killed/1 survivor; exact survivor killed by subsequently added parent-inode regression. Fresh final gates/native rerun in progress.
review_state: 'approved by maintainer: go'
spec: 9d1d3c7f58f63dad
---

# Stock Codex Identity and Operation Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task using the preserved inline execution method. Steps use checkbox (`- [ ]`) syntax for tracking. An independent final review must apply mutations and report observed outcomes.

**Goal:** Attribute observed Codescout effects to native stock-Codex callers while preserving uncertainty and existing formatter authorization.

**Architecture:** A Codex-only companion hook adapter submits bounded, sanitized observations to a local Codescout CLI. Codescout's existing native context resolver and scoped server observer capture actual calls and supported write boundaries; one Rust store implementation handles persistence. A Python reader reconciles this additive evidence with histories without manufacturing content evidence or clearing coverage gaps.

**Tech Stack:** Rust/Tokio, Node.js ESM, Python 3, JSON Schema and fixture-based cross-language tests; initially verified on Linux.

**Spec:** [Approved design](../specs/2026-11-09-stock-codex-identity-observations-design.md), artifact `9d1d3c7f58f63dad`. Spike: [normalized evidence](../../evidence/2026-11-08-stock-codex-hooks-spike.json).

## Global Constraints

- Use packaged, unmodified Codex; preserve normal yay/pacman updates and the user's client.
- Keep session-context v1 unchanged. Reuse `NativeInvocation::from_meta`; never derive a root from a lone thread ID.
- Stock observations never clear `CoverageGap`, impersonate experimental checkpoints, or grant formatter authorization on previously refused files.
- Capture is explicitly opt-in per checkout. Disabled/absent control performs no persistent observation writes; disabling preserves readable evidence.
- Store under the reached checkout's `.codescout/observations/v1/`, separate for linked checkouts and shared across profiles using that checkout.
- Limits: 64 KiB per record, 8 MiB per shard, 64 MiB per checkout; private directories/files 0700/0600. Health metadata is bounded and included in the quota.
- Persist no raw prompts, reasoning, auth/environment contents, file bodies, shell command text or tool-result bodies.
- Missing post events, arbitrary shell effects, partial failures, observer loss and lifecycle events retain uncertainty. Observation failure must not convert completed tool success into an error inviting retries.
- No package installation, live profile changes, version bump, release, trust bypass, source-Codex changes or prototype removal in this implementation.
- Native filesystem escalation is required for writes to the sibling Codescout checkout. MCP commands must not bypass filesystem restrictions.
- Commit only explicit owned paths, preserving peer work. Follow each repository's shared-checkout commit conventions.

## Review Focus

1. A hook omits its child while two calls otherwise match: remain ambiguous (Tasks 1, 5).
2. A write succeeds but result encoding, cancellation or recording fails: preserve effect/uncertainty and original result (Tasks 3, 7).
3. A symlink or checkout switch races an observer: refuse unsafe storage and retain the actual target binding (Tasks 2, 3).
4. A privacy canary arrives in an unexpected nested field or oversized input: bounded decoding, no raw value persisted (Tasks 1, 4).
5. An empty, reset, disabled, damaged or incompatible store looks healthy: never infer coverage or grant formatting clearance (Tasks 2, 5, 7).

## Execution preparation and source map

Plugin paths below are relative to this repository; `CS:` paths are relative to `/home/marius/work/claude/codescout`. These tasks form one coupled feature, not independent projects. Preserve inline execution; do not dispatch implementation agents.

Reconnaissance W-3 in [session log](../../trackers/repo-hygiene-session-log.md) established that native context already exists, `CreateFile::call` currently returns `json!("ok")`, and `src/util/fs.rs::atomic_write` is the supported create/edit write funnel. Deriving targets from tool response bodies would miss those writes. The actual edit-file module is `src/tools/edit_file/mod.rs`.

- [x] Read both repositories' current AGENTS/commit conventions, discover active passovers/peers and inspect current diffs before any source work.
- [x] Use `superpowers:using-git-worktrees` to establish isolated execution checkouts; record their base SHAs and preserve all existing dirty files.
- [x] Verify the named seams against those SHAs; if peers changed them, reconcile the plan before editing.
- [x] Use Codescout's leased build runner for Rust work. Confirm `scripts/with-slot.sh` invocation from its current help; do not hand-reuse another lease.
- [x] Record baseline targeted-test results; existing failures remain separately identified.

## Task 1: Observation contract and pure normalization

**Files:** Create `codescout-companion/contracts/operation-observation-v1.schema.json`, `codescout-companion/contracts/fixtures/operation-observations-v1.json`, `codescout-companion/hooks/observation-contract.mjs`, `codescout-companion/hooks/observation-contract.test.mjs`; create matching fixtures at `CS:tests/fixtures/operation-observations-v1.json`, `CS:src/observations/contract.rs`, `CS:scripts/observation_contract.py`, `CS:tests/test_observation_contract.py`. Modify `CS:src/lib.rs` and create `CS:src/observations/mod.rs` for module wiring.

**Interfaces:** Define serializable `ObservationV1`, `Caller`, `TargetFact`, `Fingerprint`, `Diagnostic` in Rust and the equivalent JSON/Python shapes. Required envelope: schema_version=1, observation_id, producer_instance, sequence, store_epoch, event, producer_kind, workspace, caller, tool, local_invocation, native_call_id, turn_id, fingerprints, targets, outcome, diagnostics. Nullable fields stay explicitly unknown. Events and producer kinds are exactly those in the spec. Payload data outside this allowlist is rejected before persistence.

Define `normalizeHookObservation(payload, event, workspace) -> NormalizedHook | Diagnostic` in JS, `validate_observation(value) -> ObservationV1 | validation error` in Rust, and `decode_observation(value) -> dict | diagnostic` in Python. The hook ingress shape omits store-assigned envelope fields; the store supplies epoch/producer/sequence/observation ID.

Fingerprint domain `canonical-json-safe-v1`: SHA-256 over UTF-8 JSON, sorted object keys by Unicode scalar order, no whitespace, valid Unicode scalars only, minimal JSON escaping (C0 as lowercase four-digit escapes), safe integers only; reject floats/out-of-range numbers as non-comparable. File-byte hashes use distinct domain `bytes-v1`. Never compare different domains. Golden fixtures pin non-ASCII, escaping, ordering and refusal behavior.

- [x] Add failing fixture cases for root/thread separation, duplicated native-field conflict, missing root, invalid types, NUL, identifiers over 1024 UTF-8 bytes, equal call IDs in different roots/threads/turns/checkouts, unsupported schema and privacy canaries.
- [x] Run `node --test codescout-companion/hooks/observation-contract.test.mjs` and `python3 -m pytest tests/test_observation_contract.py -q` in their owning repositories; confirm assertion/import failures for the missing contract.
- [x] Implement the schema, pure validators and fingerprint functions. Retain raw cwd only as a path field; arbitrary strings and diagnostic messages must not echo rejected payloads.
- [x] Run those tests plus leased `cargo test --lib observations::contract`; require passing tests and identical fixture bytes in both repositories.
- [x] Commit only Task 1 paths in each repository: `feat(observations): define stock caller observation contract`.

## Task 2: Private opt-in store and local ingestion CLI

**Files:** Create `CS:src/observations/store.rs`, `CS:src/cli/observations.rs`, `CS:tests/observation_store.rs`; modify `CS:src/observations/mod.rs`, `CS:src/cli/mod.rs`, `CS:src/main.rs` and `CS:.gitignore`.

**Interfaces:** `ObservationStore::open_if_enabled(root: &Path, limits: Limits) -> StoreAvailability`; `append(&self, event: SanitizedEvent) -> RecordReceipt | Diagnostic`; `read_store(root: &Path, limits: Limits) -> StoreRead`. Availability distinguishes disabled, enabled and unavailable. Limits use Global Constraints. `StoreRead` returns validated records and diagnostics, never completeness.

CLI: `codescout observations enable --workspace PATH`, `disable --workspace PATH`, `ingest-hook --workspace PATH` (normalized JSON on stdin), and `status --workspace PATH --json` (storage health only). No MCP/LSP/server startup for these commands. Canonical Git-checkout binding is verified, not accepted from stdin. Enable creates `control.json` and a new UUID epoch only for a new store; repeated enable retains epoch. Disable changes capture control without deleting logs.

Use Linux no-follow, directory-relative operations throughout storage creation/opening; check ownership, regular files and private permissions. Use one bounded interprocess quota lock (100 ms maximum wait), per-producer shards, sequence/checksum validation, and rotation without resetting sequence. Reserve 4 KiB for bounded health state within the total cap; quota exhaustion cannot trigger deletion. Server producers persist per process; a short-lived hook CLI has its own producer UUID, without claiming to detect missing invocations. Use low-level storage I/O, not the observed user-file write helper.

- [x] Add failing tests for default-disabled no-side-effects, repeated enable, disable/read, exact limit boundaries, symlinked ancestors/leaves, non-regular files, wrong checkout epoch, torn tails, invalid checksum, duplicate/conflicting IDs, sequence discontinuity, writer death and quota contention.
- [x] Run leased `cargo test --test observation_store`; verify the new behavior is absent/failing.
- [x] Implement store and CLI with fsync for committed journal records and bounded lock/health handling. Reject unsupported filesystem guarantees as unavailable. Never silently repair a corrupt journal into a coverage claim.
- [x] Run the store tests with two barrier-synchronized subprocess writers and inspect every emitted line; assert independent IDs, untorn records, caps and expected private modes. Run leased `cargo test --lib observations` and CLI help/status smoke checks.
- [ ] Commit Task 2 paths: `feat(observations): add private opt-in store and ingestion CLI`.

## Task 3: Scoped server observations and actual write targets

**Files:** Modify `CS:src/tools/invocation_context.rs`, `CS:src/server.rs`, `CS:src/util/fs.rs`, `CS:src/observations/mod.rs`; create `CS:src/observations/server.rs`; extend `CS:src/server/native_context_tests.rs` and `CS:src/observations/server_tests.rs`.

**Interfaces:** Extend validated native context with optional native call/turn fields; keep existing `apply` environment semantics and session-context v1 unchanged. Expose `observe_call(context, invocation_id, tool, sanitized_arguments, future) -> original tool result` and `observe_write(path: &Path, supplied_bytes: &[u8], phase: WritePhase)`. Task-local scoped state carries the reached checkout and caller; `LocalInvocationId` is server UUID + connection UUID + receive sequence, not JSON-RPC ID. Write phases distinguish attempted, committed and failure/uncertain. Store records carry only the approved metadata/digests.

Instrument `atomic_write` around the actual replacement boundary after existing protection checks; capture resolved path and supplied bytes without re-opening the destination. Cover errors in the atomic operation without changing its return semantics. Unsupported direct writes, renames and arbitrary commands remain possible unenumerated effects. Store writes bypass this helper to avoid recursion.

- [x] Add failing tests for native duplicated-field conflicts; two connections reusing a JSON-RPC ID; thread-only API writes with unknown root; recoverable refusal under MCP isError=false; create/edit target facts despite scalar responses; cancellation after an effect; post-write observer failure preserving success.
- [x] Run leased `cargo test --lib observations::server_tests` and existing native-context tests; confirm the new assertions fail before instrumentation.
- [x] Implement request/dispatch/result recording, actual write facts and cancellation/drop diagnostics. Reuse existing semantic refusal handling; distinguish request observation from entry into the handler. Never use a later global active-project pointer for attribution.
- [x] Add a barrier test that holds two handlers inside overlapping dispatch intervals, switches active project and performs pinned writes; assert caller/target isolation, preserved supplied-byte digests and no inferred external-shell targets.
- [x] Run all Task 3 tests plus existing create/edit and filesystem atomic-write tests through the leased runner; require original tool outputs/errors unchanged with disabled/unwritable/full stores.
- [ ] Commit Task 3 paths: `feat(observations): record scoped callers and supported write effects` (cite reconnaissance W-3).

## Task 4: Bounded Codex-only hook adapter

**Files:** Create `codescout-companion/hooks/codex-observation.mjs`, `codescout-companion/hooks/codex-observation.test.mjs`, `codescout-companion/codex/observation-hooks.json`; reuse `codescout-companion/hooks/session-context.mjs`. Do not register fixed-Codex identity in shared Claude hooks.

**Interfaces:** `runHook({event, workspace, codescoutPath, stdin, stdout, spawn}) -> Promise<void>` uses Task 1 normalization and invokes Task 2 `ingest-hook` with argv + stdin, never shell interpolation. Native session_id is root, agent_id is optional child. Raw stdin is capped at 4 MiB; normalized record remains within 64 KiB. Child CLI timeout 1500 ms; hook config timeout 3 seconds. On any recording problem, emit valid neutral hook output `{}`, without changing tool permissions/input or echoing sensitive data.

Register pre/post tool events and supported session/child/compaction lifecycle events by the host names verified in the spike. Unknown fields/events remain diagnostic; lifecycle is never termination proof.

- [x] Add failing adapter tests for real normalized spike shapes, nested Code Mode calls, missing child/root, cwd mismatch, timeout, exit-1/crash, malformed/oversized stdin and unknown nested canary fields.
- [x] Run `node --test codescout-companion/hooks/codex-observation.test.mjs`; verify missing adapter failures.
- [x] Implement adapter/config using Task 1 pure normalizer and Task 2 CLI only. Do not duplicate store locking/rotation in JavaScript.
- [x] Run adapter and session-context Node tests. Assert bounded execution, exact neutral stdout, no forbidden persisted canaries, no MCP/model/background calls and default-disabled no observation files.
- [ ] Commit Task 4 paths: `feat(hooks): add stock Codex observation adapter`.

## Task 5: Conservative Python reconciliation and read-only inspector

**Files:** Create `CS:scripts/observation_store.py`, `CS:scripts/operation_observations.py`, `CS:scripts/inspect-observations.py`, `CS:tests/test_operation_observations.py`; modify `CS:scripts/provenance_records.py`, `CS:scripts/file-provenance.py`; extend `CS:tests/test_harness_provenance.py`, `CS:tests/fmt-mine.sh`.

**Interfaces:** `read_observations(root) -> ObservationBatch`; `reconcile_observations(records, history_operations) -> Reconciliation`. Define `ObservedWrite` as minimal positive facts, distinct from existing `Operation`. Reconciliation returns facts, compatible source aliases and unresolved diagnostics. Add defaulted observational fields to `ProvenanceScan`; preserve existing owners/evidence/gaps and callers.

Pair only by full native identity/workspace/tool plus comparable fingerprints. Missing hook child joins only one compatible candidate; otherwise ambiguous. Preserve richer rollout content. No comparable fingerprint means distinct evidence, not a unique-write count. Additional observed writers may restrict an existing ownership verdict, but stock evidence alone cannot upgrade a previously refused file to formatter-authorized. Do not feed hash-only data into content evidence or checkpoint discharge.

Inspector CLI: `python3 scripts/inspect-observations.py --workspace PATH --json`, with bounded records and diagnostics using this same reader/reconciler. It opens no write handles and reports unknown/ambiguous/disabled/unavailable explicitly, never a complete-execution badge.

- [x] Add failing tests for replay idempotence/conflicts, repeated identical calls, root/thread/turn/workspace discrimination, missing-child ambiguity, incompatible hash domains, richer history preservation, fork boundaries and disabled/corrupt/incompatible stores.
- [x] Run `python3 -m pytest tests/test_operation_observations.py tests/test_harness_provenance.py -q`; confirm missing integration assertions fail.
- [x] Implement reader/reconciler/inspector and additive scan integration. Keep existing gaps byte-for-byte equivalent where possible; diagnostics may add uncertainty. No experimental checkpoint is synthesized.
- [x] Add formatter regressions asserting that a new foreign writer can restrict ownership, an unknown observed writer retains uncertainty, opaque wrapper gaps survive, and previously refused cases retain exit state and exact file bytes with observation capture enabled.
- [x] Run the Python tests and `bash tests/fmt-mine.sh`; compare inspector JSON and filesystem snapshots to prove read-only behavior.
- [ ] Commit Task 5 paths: `feat(provenance): reconcile stock observations conservatively`.

## Task 6: Source packaging, registration fixtures and test discovery

**Files:** Create `scripts/render-codex-observation-hooks.mjs`, `tests/test-codex-observation-registration.sh`; modify `codescout-companion/docs/session-context.md`, `tests/run-all.sh` only if discovery requires it. In Codescout, update the existing packaged-script resource list only if the observed current build mechanism needs explicit additions; record exact path after scouting it.

**Interfaces:** Renderer `renderObservationHooks({pluginRoot, codescoutPath, existingHooks}) -> hooksConfig` produces merged Codex configuration without overwriting unrelated hooks. CLI prints a reviewable configuration; it does not install, trust or modify real profiles. Include contract version and adapter fingerprint in diagnostics/capability output.

- [x] Add failing fixture tests for three distinct profile/cache roots, existing unrelated hooks, missing/case-distinct profile paths, incompatible contract versions, absent Codescout and an absent/disabled adapter. Assert that rendering performs no profile writes or trust changes.
- [x] Run `bash tests/test-codex-observation-registration.sh`; confirm new registration/discovery assertions fail.
- [x] Implement rendering and source packaging. Document explicit future opt-in/reload/trust steps and per-profile installed acceptance; no version bump in this feature.
- [x] Verify the new Node/shell tests are actually discovered by `tests/run-all.sh`, and Codescout's Python gate discovers the new Python tests. Package-resource smoke tests must locate every newly required runtime helper without relying on the source checkout.
- [x] Run registration tests and context-contract tests; confirm Claude shared hooks and session-context v1 fixtures remain unchanged.
- [ ] Commit Task 6 paths: `feat(observations): package Codex adapter and activation guidance`.

## Task 7: End-to-end acceptance, applied mutations and required gates

**Files:** Create `CS:tests/test_stock_observation_acceptance.py`; create normalized `docs/evidence/2026-11-09-stock-observation-acceptance.json` and `docs/evidence/2026-11-09-stock-observation-mutations.md`. Update this plan's checkboxes and approved spec's implementation state using the librarian.

- [x] Add failing integration scenarios using real observer/CLI/reader components: known root write, thread-only API write without hook, explicit refusal, arbitrary shell even with effect=read, partial error, cancellation/no post, write-store failure, disabled/untrusted or crashed-before-capture hook, torn/removed/reset journal and incompatible schema.
- [x] Run `python3 -m pytest tests/test_stock_observation_acceptance.py -q` and confirm failures correspond to missing behavior rather than fixture/setup errors.
- [x] Complete integration needed to pass those assertions; keep observation failure fail-open for tool behavior and conservative for evidence.
- [x] Exercise the packaged stock Codex in a private temporary HOME/CODEX_HOME with the source adapter and isolated Codescout state: root/resume/fork/child/compaction/post-compaction, nested Code Mode, direct App Server API, refusal and cancellation. Use stock trust review; never bypass trust or copy another profile's trust. Delete copied auth material afterwards.
- [x] Record actual versions, binary/adapter fingerprints and per-route effects. Prove concurrency only with measured overlapping dispatch intervals; otherwise mark that host route unverified while retaining the controlled server-overlap test. Commit normalized metadata only.
- [x] Apply one mutation at a time to six load-bearing seams: root/thread discrimination; local connection scope; ambiguous hook pairing; gap preservation; execution-time target binding; default-disabled capture/privacy allowlist. Run the targeted suite for each and record actual killed/surviving counts. Observe any survivor before adding its regression test, restore the mutation, then close the test gap.
- [x] Run plugin `./tests/run-all.sh` and its required buddy pytest checks; run Codescout `bash scripts/gate.sh --check` with leased builds and the existing context/history/formatter suites. Report failures/unverified routes explicitly; a quiet skipped test is not acceptance.
- [x] Request the preserved independent final review on the strongest available review model, explicitly requiring applied mutations and observed counts. Fix findings, rerun affected checks and do the required spec-drift review before claiming completion.
- [ ] Commit acceptance evidence and scoped final changes per repository; report source verification separately from future installed-profile acceptance. Do not push, release, install or claim real-profile delivery.

## Self-review and handoff

Spec mapping: criteria 1–2 → Tasks 1, 3, 6; 3–4 → Tasks 3–4, 7; 5 → Tasks 1, 5; 6 → Tasks 2–3, 7; 7–8 → Tasks 2–5, 7; 9 → Tasks 2–3; 10 → Tasks 1–4; 11 → Task 5; 12 → Tasks 1, 6–7; 13 → Task 6's documented future deployment boundary.

Self-review covers spec coverage, checkable steps, shared interface names, the five Review Focus cases and proportion. This document plans implementation; no new observer, tests or installed hooks are claimed to exist. Await maintainer plan review before starting execution.
