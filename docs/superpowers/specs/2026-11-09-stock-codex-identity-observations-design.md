---
id: '9d1d3c7f58f63dad'
kind: spec
status: approved
title: Stock Codex identity and operation observations
tags:
- codex
- session-identity
- observability
- design
approval_message: ok, go
approved_by: maintainer
approved_on: 2026-11-09
builder_review: '2026-11-09: fresh independent infrastructure builder check returned ''nothing important left''. Design sufficiency only; no runtime or implementation correctness claim.'
decision_state: approved
implementation_plan: 3f373e14fa311cc8
implementation_state: 'Source implementation and verification complete; plugin feature 381ae57, documentation bb8ff30, Codescout support 505e8033a, wiring c7b38be29 and caller tests f89590d31 committed. Manual notification approvals applied: three destinations accepted by the tool; 01a1c000 failed as not loaded. Guard ACK and mandatory trailers recorded without changing attribution rows. Source-only delivery; live installation is outside this plan.'
parent_issue: 33de9ea8980e85c9
scope: Stock Codex identity and additive operation observations; formatter authorization unchanged
---

# Stock Codex identity and operation observations

## Intent and decision

Use the packaged, unmodified Codex to attribute observed Codescout writes and native tool invocations to their actual root session and executing child. Preserve normal `yay`/pacman updates. Deliver this through Codescout and its companion plugin, without maintaining a Codex fork, replacing the user's client, or claiming a complete execution inventory.

The maintainer approved this stock-Codex adapter design on 2026-11-09 after reviewing the experiment. Storage limits and module boundaries below are approved design choices, not pre-existing preferences attributed to the maintainer. The implementation plan is approved and its source verification is recorded in the implementation-state metadata and linked evidence; deployment remains separate subsequent work.

The central invariant is: **known identity and an observed write do not establish exclusive ownership or complete effect coverage.**

## Evidence and current substrate

[Native spike, 2026-11-08](../../evidence/2026-11-08-stock-codex-hooks-spike.json) records the installed Arch Codex 0.167.0, actual binary hashes, 11 MCP requests, and eight create-file payloads matching file bytes. It demonstrated:

- MCP `sessionId`, `threadId`, `callId` and turn metadata correlate with native tool hooks, including nested Code Mode calls.
- Resume keeps the root; a new-root fork differs; a child exposes both parent root and its own thread/agent ID.
- Manual compaction emits PreCompact/PostCompact, and a later write keeps the root.
- The basic `exec --json` case includes three completed MCP items. This is one CLI observation, not a guarantee for every SDK or host.
- Explicit hook denial prevents the tested command; timeout/exit-1 permit effects. Cancellation can leave a partial effect and no post hook.
- A client-initiated App Server MCP call writes without model tool hooks and supplied only `threadId`, insufficient to establish a logical root.
- Two actual Promise.all slow calls had non-overlapping hook intervals. Simultaneous execution and contention safety were not established.

The existing [session-context contract](../../../codescout-companion/docs/session-context.md) remains authoritative. Inspected integration points in the Codescout checkout at d4d2d68335d0604b40ade6e1e017466d74ee8c50:

- `src/tools/invocation_context.rs::NativeInvocation::from_meta/apply` already accepts Codex MCP root/thread metadata and propagates it into command context. Reuse and extend its validation, not another competing resolver.
- `src/server.rs` resolves native invocation context before dispatch and scopes it around the tool future.
- `scripts/session_context.py` resolves namespaced principals, preserves child information and rejects competing native/explicit contexts.
- `scripts/codex_history.py::read_codex_history` already recovers native MCP operations and retains unsupported wrapper, fork and child-history gaps.
- `scripts/file-provenance.py::scan_provenance` merges history evidence and coverage gaps. Its checkpoint integration belongs to the separate experimental native-provenance path.
- Companion `hooks/session-context.mjs::normalizeHookContext` already normalizes an explicitly identified Codex hook payload against an actual checkout.

These are reuse seams, not evidence that the new observer is implemented.

## Approaches

| Approach | Benefit | Cost or limitation | Decision |
|---|---|---|---|
| Stock MCP metadata + companion hooks + Codescout observations | Keeps current client and package update path; native caller metadata already works | Hook delivery cannot certify complete effects | Recommended; design this route |
| A dedicated App Server client/launcher | Controls its own event subscription and session lifecycle | Changes how sessions are started; does not automatically observe existing TUI/IDE sessions | Not required for v1 |
| Patch and rebuild Codex through an Arch package | Can add producer-side guarantees unavailable to an external observer | Release-specific porting and full-host verification; existing patch fails on 0.167.0 in ten files | Preserve as research, not installation dependency |

This design replaces the requirement to patch Codex **for identity** in the [earlier experimental design](2026-11-07-native-execution-provenance-design.md). It does not claim to finish or silently replace that design's stronger execution-completeness protocol.

## Scope and non-goals

V1 provides validated request context, minimal durable observations, reconciliation with existing history evidence, read-only diagnostics, replay fixtures, and versioned hook packaging. It preserves Claude behavior and session-context v1.

V1 does not authorize formatting on previously refused files, implement worktree isolation, coordinate all external writers, infer arbitrary shell effects, guarantee background-process termination, automatically trust hooks, install a new client, modify Codex sources, publish packages, or restart running sessions. No hook presence, successful health probe or clean shutdown grants formatter clearance.

The current experimental journal/fence code is not automatically removed or activated. Stock records use a distinct schema and cannot impersonate its native checkpoints. Retirement of prototype code requires a separate scoped change.

## Architecture and responsibilities

The companion supplies a small, independently testable command-hook adapter. It reuses native hook-context normalization, extracts only allowlisted fields and writes a normalized observation. It emits only valid hook-protocol output, does not change permissions/tool input, and performs no MCP calls, model calls or background dispatch.

Codescout supplies a server observer at the actual tool-dispatch boundary. It sees native metadata, the effective checkout, resolved tool targets and the real result before model-facing truncation. It remains the source of observations for all Codescout calls, including client API calls that have no model hooks. No transparent MCP proxy is installed; the experiment's proxy remains throwaway.

A shared observation contract and storage semantics are mirrored and tested across the JavaScript adapter, Rust observer and Python reader. Existing context resolution remains the single identity policy. New observation-specific fields stay outside session-context v1.

The Python provenance consumer reads positive writer facts and observer diagnostics alongside existing histories. A bounded read-only inspector, exposed through a local CLI entry point, reports identity, operations, unresolved pairs and retained coverage gaps. Reuse the existing provenance report's vocabulary; do not introduce a second authorization policy.

## Identity contract and authority

Keep distinct fields:

| Field | Meaning |
|---|---|
| `principal` | `codex:<native root session id>` |
| `thread_id` / `agent_id` | Actual executing child when supplied; missing is retained as unknown |
| `turn_id` | Native turn, not a timestamp |
| `native_call_id` | Host call ID; not an argument fingerprint or JSON-RPC transport ID |
| `workspace` | Canonical Git checkout reached by the operation |
| `producer_kind` | `codex-hook` or `codescout-server`; describes the observation source |

Accept context only from the established native-client metadata boundary or a configured native hook adapter. User tool arguments, JavaScript literals, PID adjacency, profile names and last-writer files cannot supply identity. Client-info names and local files are not cryptographic authentication: this is a cooperative same-user integration, not protection against a hostile OS account owner or a client impersonating another client.

For MCP, require a valid nonempty native `sessionId` to establish the root. Preserve `threadId` and `callId` when available. Validate types, length limits, NUL exclusion and consistency with any duplicated identity fields in native turn metadata. Missing fields remain missing; disagreement yields a conflict rather than host precedence. A lone `threadId`, including the observed App Server API case, does not become a root.

For hooks, `session_id` supplies the root, while `agent_id` supplies child information when available. Validate native `cwd` against the reached checkout. Retain a raw turn cwd separately from a canonical checkout. When a hook's checkout differs from a matching server observation, retain the discrepancy; never relocate the server write into the hook's old active project.

Resume, compaction and a process restart do not mint a new principal. A fork's new root does not inherit authorship of copied parent operations. Child lineage comes from native metadata/history, never from equal arguments or timing. Conflicting context does not overwrite an already observed positive writer with a guessed owner.

## Observation and pairing contract

A normalized record contains schema version, observation ID, producer instance UUID, producer-local monotonic sequence, event kind, available identity fields, canonical checkout, tool name, native-call reference, validated target facts, outcome classification, payload fingerprint and diagnostic flags. Wall time is diagnostic, not identity or cross-process causal order.

Record kinds are `request-observed`, `dispatch-observed`, `result-observed`, `hook-pre`, `hook-post`, `lifecycle` and `observer-diagnostic`. Codescout distinguishes a request from entry into the actual handler. A result means the backend returned; it does not mean no further process effects are possible.

For native calls, reconcile using harness, root, executing thread, native call ID, turn and checkout, with tool/payload-fingerprint agreement. Where a hook omits thread information, attach it only when root/turn/call/checkout select exactly one compatible native call; conflicts or multiple candidates stay ambiguous. Never pair by equal arguments, timestamp proximity, transcript line number or a bare JSON-RPC ID.

Every server observation also has a local invocation ID keyed by server instance, connection instance and receive sequence. A JSON-RPC ID is only transport information and may repeat on another connection or later request. Calls lacking native IDs remain independently observable under this local ID; they cannot manufacture a principal or be heuristically joined to hook events.

Retransmission of the same observation ID with identical bytes is idempotent. A differing duplicate, contradictory results or sequence discontinuity is a diagnostic/gap. Repeated calls with identical arguments remain distinct. Producer-local sequence/checksum validation detects some storage damage; it does not attest that all producers or hook invocations were observed.

## Outcomes, partial effects and failure

The observer captures the effective workspace and resolved targets at execution time. It does not depend on the long-lived server's current global project pointer when reading the event later.

Do not equate MCP `isError: false` with a successful mutation: Codescout's recoverable refusals can use that envelope. Reuse the existing semantic refusal decoder and actual dispatch/target information. Distinguish observed dispatch, returned success, pre-effect refusal when explicitly established, error with possible effects, and missing terminal observation. A post-hook denial cannot erase an executed write.

An arbitrary shell is an opaque possible writer regardless of telemetry `effect=read`. Preserve requested command fingerprints and observed lifecycle/status, not a claim to enumerate every file or descendant it touched.

Cancellation, process death, missing post hooks, observer failure and unverified history boundaries retain uncertainty. SessionEnd, Stop, SubagentStop and PostCompact are lifecycle facts, not certificates that every child or background process stopped.

Observer failure does not turn an already successful user operation into a reported tool failure that invites a retry. Observation recording is best effort: ordinary tool behavior remains unchanged and an unavailable/unhealthy observer is reported diagnostically. A reader never interprets an empty/unreadable journal or absent health marker as complete coverage. Hook failure remains subject to the stock host's fail-open behavior.

## Storage, privacy and bounded operation

Store private, git-ignored records under the reached checkout's `.codescout/observations/v1/`. All Codex profiles and participating processes reaching that checkout use the same location; linked checkouts have separate locations. Never place mutable state inside a plugin cache snapshot or another profile's cache.

Refuse symlinked/escaping observation paths, non-regular log files and inconsistent checkout bindings. Use private directory/file permissions (0700/0600), inter-process append synchronization and bounded decoding. Unsupported filesystem guarantees produce an unavailable-observer diagnostic, not a silent claim of durability. V1 implementation targets the tested Linux environment; other platforms remain explicitly unverified until their locking/path tests pass.

Use per-producer shards so one process does not allocate another's sequence. Each line includes a record checksum; a torn tail is reported, not silently skipped. Proposed limits are 64 KiB per record, 8 MiB per shard and 64 MiB per checkout. Rotation preserves instance/sequence identity. Reserve bounded health metadata; reaching the quota stops additional capture and reports degraded recording. No automatic deletion or reset grants coverage. Manual removal/reinitialization starts a new store epoch and loses old positive evidence; rollout evidence and uncertainty remain.

Persist no raw prompts, reasoning, auth/environment contents, file bodies, shell command text or tool-result bodies. Store identifiers, allowlisted tool/action names, actual resolved paths, lengths, outcome flags and SHA-256 fingerprints of input/result/bytes already available at the execution boundary. Do not re-open a file after a write and pretend the resulting hash proves which operation wrote it. Unknown or truncated target extraction is recorded as such. Local paths and fingerprints remain private diagnostic data.

Hook processing is bounded and synchronous. Exceeding limits yields an explicitly incomplete observation or diagnostic, never silent truncation interpreted as a complete event.

## Provenance integration and formatter boundary

The new reader produces positive writer observations plus gaps/diagnostics. Preserve the existing `Operation`/history pipeline; do not fabricate full tool input or file-content evidence from hashes.

Add actual target/principal facts conservatively to the existing provenance result. When the same native call also exists in a rollout, reconcile only with compatible full identity and fingerprint semantics; keep source aliases rather than inventing another write. If fingerprints cannot be compared, retain distinct evidence records without treating their count as a count of unique writes. Existing richer evidence is not overwritten by a minimal observation.

Known additional writers may make a file shared. Missing identities, contradictory records or possible effects keep it unknown as appropriate. Observation records never remove `CoverageGap` entries, including opaque Code Mode wrappers. The existing native-checkpoint discharge path accepts only its own verified experimental protocol, never these records.

The formatter's authorization rules and exit states remain unchanged. This work makes statements such as “a child of this root performed this observed write” more accessible. It does not turn them into “only this root could have modified the file.” `--check` stays read-only. Any explicit exclusive-checkout declaration retains its existing operator semantics and is never inserted automatically.

## Packaging, activation and compatibility

Ship the adapter with the companion plugin, and the server observer/reader/inspector with Codescout. Their contract version must be checked; incompatible records yield diagnostics and no invented evidence. Absence of one side must not prevent normal tools from running. Existing Claude paths are unaffected.

Keep session-context v1 unchanged. Add a versioned observation schema and fixture corpus in the companion contract area and matching compatibility tests in Codescout. Source-only adapter code is insufficient: the later release must register the Codex events, validate actual hook trust and prove the running packaged adapter's identity.

Use the existing installation/release mechanisms. Deployment must inspect every configured Codex instance from the machine's profile inventory, including the three named personal profiles and actual case-sensitive locations. Do not create missing profiles or assume a lowercase and uppercase directory are the same. Each existing profile uses its own install record/cache root. Hook trust is reviewed through the stock host; no trust-bypass flag, copied trust state from a peer, or automatic permission broadening.

Enable capture explicitly per checkout after compatible server/plugin installation; without enablement, the adapter performs no persistent observation writes. This enablement is an observation setting, never an exclusive-control declaration. Existing sessions need a verified reload or cold start as appropriate; editing install records alone is not runtime evidence.

Capability status names the measured host version, binary/plugin fingerprints and exercised routes. Codex 0.167.0 on Linux is the initial observed case, not a minimum supported range. Do not claim parallel execution from the Promise.all spike. Disablement stops new capture and leaves prior evidence readable; removal of private state can only reduce knowledge, not grant clearance.

## Acceptance criteria

1. Packaged stock Codex and Code Mode host run without custom source changes; default package-update behavior remains intact.
2. Existing native request context and session-context v1 are reused; missing root, competing contexts and duplicated-field conflicts are exercised.
3. Real root, resume, new-root fork, child, compaction and post-compaction observations preserve the measured identity distinctions.
4. Server observation covers a client API write with no hook; a thread-only request keeps unknown root while retaining the actual operation/target.
5. Repeated identical calls, connection-local request-ID reuse, retransmissions, conflicting duplicates and missing child detail never cause an unsafe join.
6. Tests with genuinely overlapping dispatches verify independent caller context and untorn appends. A non-overlap or unavailable host case is reported as unverified, not passing concurrency coverage.
7. Native shell, arbitrary MCP shell, explicit refusal, error after partial effects, cancellation and missing post hook retain their correct uncertainty.
8. Hook timeout, crash before capture, disabled/untrusted hook, inaccessible/full store, torn records and writer-process death cannot produce complete coverage or formatter clearance.
9. Resolved targets remain bound to the actual checkout under project activation, pinned writes, symlink attempts and linked-worktree cases.
10. Privacy fixtures contain canary prompts, credentials, command/file/result bodies and assert their absence from stored observations; malformed and oversized inputs are bounded.
11. History/observation coexistence retains richer evidence, handles replay/fork boundaries and never clears an unrelated or opaque coverage gap. Ordinary formatting still refuses the spike's unproved cases and preserves bytes.
12. Cross-repository schema fixtures and existing context, history, provenance, hook-output and formatter tests remain green. Run each repository's required gates when implementing, with meaningful applied mutations on root/thread keys, pairing scope, gap preservation and target binding.
13. A future deployment verifies each real profile independently and confirms actual event delivery after reload. No source test is reported as installed acceptance.

## Verification strategy and builder decisions

Implementation should begin with normalized fixture captures and negative cases, then server/hook readers, additive provenance integration and finally packaged native acceptance. Live evidence must record what actually executed, not just process exit 0. Keep raw captures private; commit only normalized evidence.

A fresh builder review checks whether this document is sufficient to plan. It is a design review, not runtime verification or a substitute for mutation-testing the eventual implementation.

The builder may choose module names, internal Rust/Python representations, test harness layout and inspector flags. They must preserve the authority, pairing, privacy, coverage and installation boundaries above. Defaults proposed here may be adjusted with a recorded rationale; changes to formatter authorization, client-launch workflow or the no-Codex-patch scope require a separate design decision.

## Approval and delivery state

Approved by the maintainer on 2026-11-09 («ok, go»). Implementation plan `3f373e14fa311cc8` is complete for source delivery. Plugin feature `381ae57` and documentation `bb8ff30`, plus Codescout support `505e8033a`, wiring `c7b38be29` and real caller tests `f89590d31`, are committed in isolated worktrees. Required gates, independent applied-mutation review and the ten-route native stock acceptance passed; the source/spec review records GO in `57ada03063a50be6`.

This delivery uses the packaged, unmodified Codex. Live profile activation, integration, release and installation remain outside this approved source-only plan. Host dispatch overlap remains unverified; controlled server-handler overlap is tested. The attribution incident `16de4012209e895f` remains open: the operator-approved ACK records observed wrong stamps and does not establish or repair their cause.
