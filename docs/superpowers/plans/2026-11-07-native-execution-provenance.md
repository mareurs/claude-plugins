---
id: '46b174b8c4c5e2e2'
kind: plan
status: active
title: Native execution provenance implementation
tags:
- session-identity
- provenance
- implementation
---

# Native execution provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Supply durable native execution evidence and a cooperative write fence without clearing unproved ownership gaps.

**Architecture:** A lossless append-only native journal is independent of warehouse metadata. A caller-bound checkpoint flows through native MCP metadata; Codescout validates it only while the formatter holds the common checkout fence. Unsupported or incomplete producers retain UNKNOWN.

**Tech Stack:** Rust, JSONL/SHA-256, Python, POSIX advisory locks.

**Spec:** [Approved design](../specs/2026-11-07-native-execution-provenance-design.md).

## Global Constraints

- Keep session-context v1, peer/refusal semantics and unrelated local changes.
- No public Responses schema changes, deployment, profile edits or publication.
- Work in /tmp/native-provenance-20261107-{codex,codescout}; original checkouts remain unchanged until reviewed patches pass git apply --check and native filesystem escalation.
- Missing sequence/terminal/lineage/fence capability stays UNKNOWN; no JavaScript inference.
- Support only explicitly instrumented surfaces. Unsupported native tools and missing participant capabilities prevent clearance.

## Review Focus

- An active wrapper is not terminal evidence: bind the exact formatter invocation and only its certified prefix.
- Identical calls remain distinct; missing or conflicting events never disappear through deduplication.
- Cancellation or parent death must not release protection while a formatter descendant can still write.
- Replayed/substituted files and wrong native root/thread/epoch refuse before bytes change.
- Missing native capability and unrelated older history gaps retain refusal.

### Task 1: Durable journal and verification contract

**Files:** Create Codex core/src/tools/native_provenance.rs and its focused test harness; create Codescout scripts/native_provenance.py and tests/test_native_provenance.py.

**Interfaces:** Rust Journal::create(path, identity), Journal::record(kind, data) -> Checkpoint; Python verify_checkpoint(checkpoint, native_identity, history_path) -> verified event prefix or error. Identity includes schema, root, thread, epoch and history-prefix binding. Hash each exact record payload with its monotonic ordinal and previous digest; sync before checkpoint export. Append failure permanently poisons the producer. Each checkpoint binds a unique invocation ID.

- [x] Write failing Rust tests for persistence/hash linkage, duplicate IDs, append failure, invocation binding and concurrency; observe RED.
- [x] Implement create-new private journal and poisoned failure state; verify GREEN.
- [x] Write failing consumer tests for genuine journal, corruption, truncation, ordinal gaps, wrong identity/epoch/invocation/history/schema and forged result metadata.
- [x] Implement strict bounded verification; errors remain coverage gaps.

### Task 2: Native dispatch and cell lifecycle

**Files:** Codex tools/registry.rs, tools/code_mode/{delegate,execute_handler}.rs, tools/executed_tool_calls.rs, mcp_tool_call.rs and code-mode grpc lifecycle.

**Interfaces:** Reuse Task 1 journal. A native-only metadata key carries a checkpoint for the actual MCP invocation. Cells link to wrapper call IDs; receipt, pre-effect dispatch and outcome are distinct. Closure reports issued slots; missing slots and pending calls prevent completeness.

- [x] Pin receipt/cancellation/dispatch/outcome/final-sequence behavior with failing tests, including late callbacks and identical arguments. Stdio and gRPC both carry native issued-slot observations; full-host native acceptance remains separately pending.
- [x] Integrate producer independently of warehouse completeness; flush native history before checkpoints. New default-off native_execution_provenance preserves warehouse flag compatibility.
- [ ] Verify resume/fork/child/compaction boundaries; unsupported lineage stays incomplete.

### Task 3: Cooperative fence and shell lifetime

**Files:** Codescout server/invocation_context, a separate provenance fence module, run_command process boundaries and formatter coordinator.

**Interfaces:** New provenance fence is distinct from telemetry-only effect and existing write.lock policy. Canonical checkout resolved before locking. All participating writes honor it; formatter owns it from evaluation through actual last write, bound to checkpoint. Unsupported surfaces or missing capability refuse clearance.

- [ ] Write failing multi-process tests for sibling/child dispatch after checkpoint, wrong checkout, interrupted caller with live formatter, missing capability and unsupported background work.
- [x] Implement common enforcement and process-lifetime holder; no snapshot-only clearance. Bind durable global coordination and canonical-checkout generations; arbitrary shells persist uncertainty before effects. Exact verified formatter closure is the only shell exception.
- [ ] Verify byte equality on refusal and dispatch blocked until formatter completion.

### Task 4: Reader and native acceptance

**Files:** Codescout codex_history.py, file-provenance.py, fmt-mine.sh, harness tests and plugin capability docs.

**Interfaces:** Task 1 verified prefix + Task 2 lifecycle + Task 3 bound fence. Normalize into Operation/CoverageGap; discharge only specific fully proved opaque gaps.

- [x] Observe RED for selective gap discharge and unrelated gap preservation; implement and verify GREEN. Include unrelated reasons on the same certified source locator.
- [ ] Run focused suites, native write/resume/owned-format and mixed-host refusal with hashes. Record exact versions and real tool exit codes; unsupported cases explicit.
- [x] Run required gates after source settles; independent review applies actual mutations before closing gaps.
- [x] Produce reviewed patches and git apply --check before native filesystem escalation; no release/install. Applied both patches to original source checkouts and verified reverse checks, preserving concurrent peer changes.

## Verification state — 2026-11-07

Reviewed implementation is committed locally in the original Codex (`c4d58a767b`) and Codescout (`9cab1095e`) checkouts. Source delivery is complete; full matching-host native acceptance remains pending. Current focused gates: Code Mode 76 tests; host protocol 41; actual stdio host transport/delegate/frontier modules 6; MCP 256; journal/fence/capability harness 25; Codescout fence/context 18, trusted formatter 5 and attribution 50. Relevant Python tests: 143 plus 25 subtests; the journal verifier also passed 12 tests plus 11 subtests against actual Rust-produced bytes. These are distinct suites, not a combined coverage claim.

A full matching native host cannot currently be built: V8 150.4.0 download returned 404, and DOCS_RS type checking lacks generated bindings. Module tests use the actual production source and protocol without replacing V8 with fake runtime behavior. The initial native probes established root/write/resume identity and safe UNKNOWN refusal only. Kat authentication remains unestablished and was not retried. Independent review found three Important issues; all are corrected in the reviewed source. The previously surviving marker-order and constant-sequence mutations were reapplied and killed by the new cancellation and two-callback integration regressions. The final complete gate passed: Python light 1756 tests plus 554 subtests, FMT=0/CLIPPY=0/LEAN=0/DEFAULT=0, lean 6206 passed and default 9088 passed. Standard documented exclusions remain. Concurrent path-display/fixture changes were inspected and merged into the integration snapshot; native-wire 8 and large-routing 1 passed there before applying the source patches. The issue stays investigating.

Availability limit: every arbitrary shell persists global uncertainty with no automatic reset; ordinary commands and peer edits continue, but post-build native owned formatting is not claimed. The trusted formatter requires the exact shipped helper closure, sanitized startup environment and trusted installed OS tools.
